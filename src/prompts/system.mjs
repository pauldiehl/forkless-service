/**
 * System prompt builder for the multi-tenant service.
 * Wraps forkless/lib/agent/prompts.js via createRequire, then merges
 * tenant-specific context (system_prompt, board summary, FAQ summary).
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let buildSystemPrompt;
try {
  const prompts = require('forkless/lib/agent/prompts');
  buildSystemPrompt = prompts.buildSystemPrompt;
} catch {
  // Fallback if forkless module isn't available (e.g. in tests)
  buildSystemPrompt = null;
}

/**
 * Build the full system prompt for a tenant conversation.
 *
 * @param {Object} tenant - Tenant record from DynamoDB
 * @param {Object} [opts]
 * @param {Object} [opts.boardSummary] - Board summary from board.getSummary()
 * @param {string} [opts.userType] - 'customer' | 'admin' | 'founder' | 'builder'
 * @param {Array}  [opts.faqSummary] - Cached FAQ entries for context
 * @returns {string} Complete system prompt
 */
export function buildTenantPrompt(tenant, opts = {}) {
  const { boardSummary, userType, faqSummary } = opts;

  // Use forkless buildSystemPrompt if available
  if (buildSystemPrompt) {
    const config = {
      name: tenant.name || tenant.tenant_id,
      description: tenant.description || '',
      tone: tenant.tone || '',
      userType: userType || 'customer',
      capabilities: tenant.capabilities || [],
      artifacts: tenant.artifacts || [],
      boardState: boardSummary ? { stages: boardSummary.stages || {} } : null,
    };

    // Add tenant protocols if available
    if (tenant.protocols) {
      config.protocols = Array.isArray(tenant.protocols) ? tenant.protocols : [tenant.protocols];
    }

    let prompt = buildSystemPrompt(config);

    // Append tenant's custom system prompt
    if (tenant.system_prompt) {
      prompt += `\n\n## Tenant Knowledge\n${tenant.system_prompt}`;
    }

    // Append FAQ context
    if (faqSummary && faqSummary.length > 0) {
      const faqSection = faqSummary
        .map(f => `Q: ${f.question}\nA: ${f.answer}`)
        .join('\n\n');
      prompt += `\n\n## Known FAQ (respond from memory, no LLM needed)\n${faqSection}`;
    }

    // Domain guardrails — keep agent on-topic
    const descShort = (tenant.description || '').split('.')[0].trim() || tenant.name || tenant.tenant_id;
    prompt += `\n\n## Domain Guardrails
You are a domain-specific knowledge agent for ${tenant.name || tenant.tenant_id}. Your ONLY expertise is the content in the Knowledge and FAQ sections above.

Rules:
- If a question relates to your knowledge domain, answer from your knowledge.
- If a question uses a term that exists in your knowledge (e.g. a product name, concept name), ALWAYS interpret it in the context of your knowledge domain, never as a general term.
- If a question is clearly outside your domain and has NO connection to your knowledge, say: "That's outside my expertise. I'm here to help with ${descShort}. What would you like to know?"
- Never fabricate information not in your knowledge base.
- Never pivot to general-purpose explanations when domain-specific knowledge exists.`;

    // Conciseness rules
    prompt += `\n\n## Response Style
- Keep responses to 1-3 sentences. Be direct and conversational.
- No bullet lists unless the user asks for a breakdown.
- No preamble ("Great question!", "Sure!", "Absolutely!"). Just answer.
- Use generate_artifact tool for long-form content (>5 lines).`;

    // Onboarding intake — conditional on tenant flag
    if (tenant.intake_enabled) {
      prompt += `\n\n## Onboarding Intake
You can onboard new users to the Forkless platform. When someone expresses interest in getting their own agent, collect these fields one or two at a time through natural conversation:

1. Business/project name → suggest a URL-safe slug (lowercase-hyphens)
2. Description (1-2 sentences — what should the agent help with?)
3. Admin email(s)
4. Website URL
5. Other knowledge URLs (docs, GitHub repos, guides)
6. Tone (how should the agent sound?)
7. Brand accent color (hex, or describe and you pick)
8. Greeting message

Keep each question to ONE sentence. Don't list all fields at once — ask naturally, one or two at a time. Once you have everything, confirm the summary and call create_tenant.`;
    }

    return prompt;
  }

  // Minimal fallback prompt
  const sections = [];
  sections.push(`You are the ${tenant.name || tenant.tenant_id} agent on the Forkless platform.`);

  if (tenant.description) sections.push(tenant.description);

  if (tenant.system_prompt) {
    sections.push(`## Knowledge\n${tenant.system_prompt}`);
  }

  if (boardSummary) {
    sections.push(`## Architecture — Three Layers
You operate in a three-layer UI stack:
1. AGENT LAYER (you) — The conversation.
2. PLANNING LAYER (Driftboard) — Spatial card overlay.
3. TRANSACTION LAYER — The product beneath.

Use tools to control board display, create cards, and generate artifacts.`);

    const counts = Object.entries(boardSummary.stages || {})
      .filter(([, n]) => n > 0)
      .map(([stage, n]) => `- ${stage}: ${n} items`)
      .join('\n');
    sections.push(`## Current Board\n${counts || 'Board is empty.'}`);
  }

  if (faqSummary && faqSummary.length > 0) {
    const faqSection = faqSummary
      .map(f => `Q: ${f.question}\nA: ${f.answer}`)
      .join('\n\n');
    sections.push(`## Known FAQ\n${faqSection}`);
  }

  // Domain guardrails — keep agent on-topic
  const descShort = (tenant.description || '').split('.')[0].trim() || tenant.name || tenant.tenant_id;
  sections.push(`## Domain Guardrails
You are a domain-specific knowledge agent for ${tenant.name || tenant.tenant_id}. Your ONLY expertise is the content in the Knowledge and FAQ sections above.

Rules:
- If a question relates to your knowledge domain, answer from your knowledge.
- If a question uses a term that exists in your knowledge (e.g. a product name, concept name), ALWAYS interpret it in the context of your knowledge domain, never as a general term.
- If a question is clearly outside your domain and has NO connection to your knowledge, say: "That's outside my expertise. I'm here to help with ${descShort}. What would you like to know?"
- Never fabricate information not in your knowledge base.
- Never pivot to general-purpose explanations when domain-specific knowledge exists.`);

  // Onboarding intake — conditional on tenant flag (fallback path)
  if (tenant.intake_enabled) {
    sections.push(`## Onboarding Intake
You can onboard new users to the Forkless platform. When someone expresses interest in getting their own agent, collect these fields one or two at a time through natural conversation:

1. Business/project name → suggest a URL-safe slug (lowercase-hyphens)
2. Description (1-2 sentences — what should the agent help with?)
3. Admin email(s)
4. Website URL
5. Other knowledge URLs (docs, GitHub repos, guides)
6. Tone (how should the agent sound?)
7. Brand accent color (hex, or describe and you pick)
8. Greeting message

Keep each question to ONE sentence. Don't list all fields at once — ask naturally, one or two at a time. Once you have everything, confirm the summary and call create_tenant.`);
  }

  const rules = [
    '- Keep responses to 1-3 sentences. Be direct and conversational.',
    '- No preamble ("Great question!", "Sure!"). Just answer.',
    '- Use generate_artifact tool for long-form content (>5 lines)',
  ];
  if (boardSummary) {
    rules.push('- Reference card IDs when discussing board items (#1247, etc.)');
    rules.push('- Suggest board mode changes when contextually appropriate');
  }
  sections.push(`## Response Rules\n${rules.join('\n')}`);

  return sections.join('\n\n');
}
