/**
 * Async chat stream worker — streams Claude response tokens via WebSocket.
 *
 * Invoked asynchronously by the chat handler when a WebSocket connection
 * is available. Streams token chunks to the client in real-time, then
 * saves the completed response to the conversation.
 *
 * Event payload: {
 *   tenant_id, email, conversation_id, connection_id,
 *   system_prompt, messages, model, max_tokens, tools,
 *   board_context
 * }
 */

import { loadConversation, saveConversation } from '../lib/conversation-store.mjs';
import { executeTool } from '../lib/tools.mjs';
import { pushToConnection } from '../lib/ws-push.mjs';
import { recordAnswer } from '../lib/faq.mjs';

export async function handler(event) {
  const {
    tenant_id,
    email,
    conversation_id,
    connection_id,
    system_prompt,
    messages,
    model = 'claude-sonnet-4-6',
    max_tokens = 1024,
    tools = [],
    board_context,
  } = event;

  console.log(`Stream worker: tenant=${tenant_id} conv=${conversation_id} conn=${connection_id}`);

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic();

    // Stream the Claude response
    const stream = anthropic.messages.stream({
      model,
      max_tokens,
      system: system_prompt,
      messages: messages.map(m => ({
        role: m.role === 'agent' ? 'assistant' : m.role,
        content: m.content,
      })),
      tools: tools.length > 0 ? tools : undefined,
    });

    let fullText = '';
    let actions = [];

    // Push token chunks via WebSocket
    stream.on('text', (text) => {
      fullText += text;
      pushToConnection(connection_id, {
        channel: 'stream',
        type: 'chunk',
        conversation_id,
        text,
      }).catch(() => {});
    });

    // Wait for the complete message
    const finalMessage = await stream.finalMessage();

    // Handle tool calls if any
    const toolUses = finalMessage.content.filter(b => b.type === 'tool_use');
    if (toolUses.length > 0) {
      for (const toolUse of toolUses) {
        const result = await executeTool(toolUse.name, toolUse.input, {
          board: board_context?.board || null,
          tenantId: tenant_id,
        });
        if (result.action) actions.push(result);
      }

      // Follow-up call with tool results (non-streaming for simplicity)
      const toolMessages = [
        ...messages.map(m => ({
          role: m.role === 'agent' ? 'assistant' : m.role,
          content: m.content,
        })),
        { role: 'assistant', content: finalMessage.content },
        ...toolUses.map(tu => ({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify(
              actions.find(a => a.action)?.result || 'Done'
            ),
          }],
        })),
      ];

      const followUp = await anthropic.messages.create({
        model,
        max_tokens,
        system: system_prompt,
        messages: toolMessages,
        tools: tools.length > 0 ? tools : undefined,
      });

      const followUpText = followUp.content.find(b => b.type === 'text')?.text || '';
      if (followUpText) {
        fullText += followUpText;
        await pushToConnection(connection_id, {
          channel: 'stream',
          type: 'chunk',
          conversation_id,
          text: followUpText,
        });
      }
    }

    // Save conversation with complete response
    const conversation = await loadConversation(tenant_id, conversation_id);
    if (conversation) {
      conversation.messages.push({ role: 'assistant', content: fullText });
      await saveConversation(conversation);
    }

    // Signal stream end
    await pushToConnection(connection_id, {
      channel: 'stream',
      type: 'end',
      conversation_id,
      actions,
    });

    // Attempt FAQ crystallization
    const userMsg = messages[messages.length - 1]?.content || '';
    recordAnswer(tenant_id, userMsg, fullText).catch(() => {});

    console.log(`Stream complete: ${fullText.length} chars, ${actions.length} actions`);
    return { success: true, length: fullText.length };
  } catch (err) {
    console.error(`Stream worker error for ${tenant_id}:`, err);

    // Push error to client
    await pushToConnection(connection_id, {
      channel: 'stream',
      type: 'error',
      conversation_id,
      error: 'Something went wrong generating the response. Please try again.',
    }).catch(() => {});

    return { success: false, error: err.message };
  }
}
