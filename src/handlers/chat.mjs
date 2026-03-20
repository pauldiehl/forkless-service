/**
 * POST /chat — The main engine.
 *
 * Flow: validate tenant -> check FAQ cache -> load/create conversation ->
 *       build system prompt -> create agent -> handle message -> parse actions ->
 *       save conversation -> attempt FAQ crystallization -> return response
 */

import { createRequire } from 'node:module';
import { authenticateRequest, success, error } from '../lib/auth.mjs';
import { getTenant } from '../lib/tenant.mjs';
import { getItem, putItem } from '../lib/dynamo.mjs';
import { createConversation as createConv, loadConversation, saveConversation } from '../lib/conversation-store.mjs';
import { checkCache, recordAnswer } from '../lib/faq.mjs';
import { TOOLS, executeTool } from '../lib/tools.mjs';
import { buildTenantPrompt } from '../prompts/system.mjs';

const require = createRequire(import.meta.url);
const CHAT_RATE_LIMIT = parseInt(process.env.CHAT_RATE_LIMIT || '50', 10);

let forklessCreateConversation;
let forklessCreateBoard;
try {
  const agentLib = require('forkless/lib/agent/conversation');
  forklessCreateConversation = agentLib.createConversation;
  const planningLib = require('forkless/lib/planning/board');
  forklessCreateBoard = planningLib.createBoard;
} catch {
  // Fallback for when forkless isn't linked
  forklessCreateConversation = null;
  forklessCreateBoard = null;
}

export async function handler(event) {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return error('Invalid JSON', 'INVALID_JSON');
  }

  const { message, tenant_id, conversation_id } = body;

  if (!message) {
    return error('message is required', 'MISSING_MESSAGE');
  }
  if (!tenant_id) {
    return error('tenant_id is required', 'MISSING_TENANT');
  }

  // 1. Validate tenant
  const tenant = await getTenant(tenant_id);
  if (!tenant) {
    return error('Unknown tenant', 'UNKNOWN_TENANT', 404);
  }

  // 2. Check FAQ cache (free — no Claude call)
  const faqResult = await checkCache(tenant_id, message);

  // 3. FAQ cache hit — persist into conversation if authenticated, return cached answer
  if (faqResult.hit) {
    const faqUser = authenticateRequest(event);
    if (faqUser) {
      // Authenticated: save Q&A into conversation for context continuity
      let conv;
      if (conversation_id) conv = await loadConversation(tenant_id, conversation_id);
      if (!conv) conv = await createConv(tenant_id, faqUser.email);
      conv.messages.push({ role: 'user', content: message });
      conv.messages.push({ role: 'assistant', content: faqResult.answer });
      await saveConversation(conv);
      return success({
        reply: faqResult.answer,
        conversation_id: conv.conversation_id,
        source: 'faq_cache',
        actions: [],
      });
    }
    // Anonymous: return FAQ answer without conversation (still free)
    return success({
      reply: faqResult.answer,
      source: 'faq_cache',
      actions: [],
    });
  }

  // 4. Require auth — reject unauthenticated requests
  const user = authenticateRequest(event);
  if (!user) {
    return error('Authentication required', 'AUTH_REQUIRED', 401);
  }
  const userType = user.trustLevel === 'admin' ? 'admin' : 'customer';
  const email = user.email;

  // 5. Load or create conversation
  let conversation;
  if (conversation_id) {
    conversation = await loadConversation(tenant_id, conversation_id);
  }
  if (!conversation) {
    conversation = await createConv(tenant_id, email);
  }

  // Add user message to history
  conversation.messages.push({ role: 'user', content: message });

  // 6. Rate limiting — per-email per-day counter in OTP table (only for LLM calls)
  const rateLimitKey = `rate-${email}-${new Date().toISOString().slice(0, 10)}`;
  const rateRecord = await getItem('otp', { tenant_id, email: rateLimitKey });
  const currentCount = rateRecord?.count || 0;

  if (currentCount >= CHAT_RATE_LIMIT) {
    return error(`Daily limit reached (${CHAT_RATE_LIMIT} messages per day)`, 'RATE_LIMITED', 429);
  }

  const ttl = Math.floor(Date.now() / 1000) + 86400;
  await putItem('otp', { tenant_id, email: rateLimitKey, count: currentCount + 1, ttl });

  // 7. Build board state for context (gated by tenant.board_enabled)
  let board = null;
  let boardSummary = null;
  const boardEnabled = tenant.board_enabled === true;
  if (boardEnabled && forklessCreateBoard) {
    board = await forklessCreateBoard();
    boardSummary = board.getSummary();
  }

  // 8. Build system prompt + filter tools
  const systemPrompt = buildTenantPrompt(tenant, {
    boardSummary: boardEnabled ? boardSummary : null,
    userType,
  });

  const BOARD_TOOLS = ['show_board', 'focus_card', 'create_board_card', 'set_display_mode'];
  const INTAKE_TOOLS = ['create_tenant'];
  let activeTools = boardEnabled ? TOOLS : TOOLS.filter(t => !BOARD_TOOLS.includes(t.name));
  if (!tenant.intake_enabled) {
    activeTools = activeTools.filter(t => !INTAKE_TOOLS.includes(t.name));
  }

  // 9. Create agent and handle message
  let reply = '';
  let actions = [];

  if (forklessCreateConversation) {
    const agent = forklessCreateConversation(
      {
        name: tenant.name || tenant.tenant_id,
        description: tenant.description || '',
        userType,
        model: tenant.model || 'claude-sonnet-4-6',
        maxTokens: tenant.max_tokens || 4096,
      },
      {
        tools: activeTools,
        executeTool: (name, input) => executeTool(name, input, { board, tenantId: tenant_id }),
        getBoardState: () => boardSummary,
      }
    );

    // Override the prompt with our tenant-enriched version
    agent.reloadPrompt();

    const result = await agent.handleMessage(conversation.messages);
    reply = result.text;
    actions = result.actions || [];
  } else {
    // Fallback: direct Claude call without forkless wrapper
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic();

    const response = await anthropic.messages.create({
      model: tenant.model || 'claude-sonnet-4-6',
      max_tokens: tenant.max_tokens || 4096,
      system: systemPrompt,
      messages: conversation.messages.map(m => ({
        role: m.role === 'agent' ? 'assistant' : m.role,
        content: m.content,
      })),
      tools: activeTools.length > 0 ? activeTools : undefined,
    });

    // Process tool calls
    const toolUses = response.content.filter(b => b.type === 'tool_use');
    if (toolUses.length > 0) {
      for (const toolUse of toolUses) {
        const result = await executeTool(toolUse.name, toolUse.input, { board, tenantId: tenant_id });
        if (result.action) actions.push(result);
      }
    }

    const textBlock = response.content.find(b => b.type === 'text');
    reply = textBlock ? textBlock.text : '';
  }

  // 10. Save conversation with assistant reply
  conversation.messages.push({ role: 'assistant', content: reply });
  await saveConversation(conversation);

  // 11. Attempt FAQ crystallization (fire-and-forget)
  recordAnswer(tenant_id, message, reply).catch(() => {});

  // 12. Extract board update from actions
  const boardUpdate = actions.find(a => a.action === 'show_board')?.columns || null;

  return success({
    reply,
    conversation_id: conversation.conversation_id,
    actions,
    boardUpdate,
    usage: {
      remaining: CHAT_RATE_LIMIT - currentCount - 1,
      limit: CHAT_RATE_LIMIT,
    },
  });
}
