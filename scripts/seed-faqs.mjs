#!/usr/bin/env node
/**
 * Pre-populate FAQ cache with crystallized Q&A pairs for paul-brand.
 * These bypass the LLM entirely — zero cost for common questions.
 * Usage: node scripts/seed-faqs.mjs
 */

import { createHash } from 'node:crypto';
import { putItem } from '../src/lib/dynamo.mjs';

const tenantId = 'paul-brand';
const now = new Date().toISOString();

function hashQuestion(q) {
  return createHash('sha256').update(q.toLowerCase().trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 16);
}

const faqs = [
  {
    question: 'what is web 4.0',
    answer: "Web 4.0 is the trust economy era of the internet. Where Web3 tried to decentralize everything with tokens and blockchain, Web 4.0 says: the AI agent IS the interface. Trust is earned through behavior and contribution, not cryptographic proof. The agent handles the complexity — the user gets simplicity.",
  },
  {
    question: 'what is forkless',
    answer: 'Forkless is a pattern library for building three-layer AI stacks. The name means "there is no fork" — instead of forking repos and customizing, you configure a tenant and the AI adapts. The three layers: Agent (chat), Planning (Driftboard kanban), Transaction (product/artifacts).',
  },
  {
    question: 'what is diab',
    answer: "DIAB stands for Disruption-in-a-Box. It's a framework for disrupting legacy industries using AI agents. Drop a DIAB on insurance, healthcare, banking — the agent handles the industry complexity while the user gets a simple conversational interface. Think of it as a pre-packaged disruption engine.",
  },
  {
    question: 'what is the agent intake protocol',
    answer: "The Agent Intake Protocol (AIP) is an open standard for AI agents to discover and communicate with each other. Think DNS for agents. An agent registers at agentintake.io with its capabilities, and other agents can find it. It includes certification (proving an agent does what it claims) and a trust registry.",
  },
  {
    question: 'what is the driftboard',
    answer: "The Driftboard is the Planning Layer — a spatial kanban overlay that the agent controls. It has 6 stages: intake → qualified → grooming → building → validate → done. Cards move through stages based on merit scoring and coordinator evaluation. Users interact via comments, not drag-and-drop. The agent decides which cards are visible.",
  },
  {
    question: 'what is the three layer architecture',
    answer: "The three-layer architecture is: 1) Agent Layer (conversational, sequential, present-focused), 2) Planning Layer / Driftboard (spatial, past+present+future), 3) Transaction Layer (the product beneath — artifacts, payments). The agent is always on top as a transparent overlay. It controls what's visible on the planning layer.",
  },
  {
    question: 'what is the trust economy',
    answer: "The trust economy replaces paywalls and token gates with earned trust tiers. Users start as viewers, become registered after auth, earn 'trusted' status through consistent contribution, and can reach 'founder' status. The more you participate, the more the system trusts you with. Trust is the currency.",
  },
  {
    question: 'what is crowdsourced disruption',
    answer: "CrowdSourced Disruption lets the crowd be the product team. Instead of a startup burning runway, you let people submit prompts. The Driftboard triages them by merit (alignment, feasibility, novelty, non-conflict, specificity). Best ideas get built. The crowd funds, designs, and validates — the AI builds.",
  },
  {
    question: 'who is paul diehl',
    answer: "Paul Diehl is a Web 4.0 builder. He created the Forkless platform, DIAB (Disruption-in-a-Box), and the Agent Intake Protocol. His thesis: the AI layer that replaces forms, dashboards, and menus will be the biggest platform shift since mobile. He builds in public and believes trust is earned, not bought.",
  },
  {
    question: 'how does faq crystallization work',
    answer: "When the same question is asked 3+ times and the agent gives consistent answers (>60% word overlap), the answer 'crystallizes' — it gets cached. Next time someone asks, the cached answer is returned instantly without calling the LLM. This saves API costs and ensures consistent answers for common questions.",
  },
  {
    question: 'what is merit scoring',
    answer: "Merit scoring evaluates incoming ideas on 5 weighted criteria: alignment (30%) — does it serve the objective?, feasibility (25%) — can it be built?, non-conflict (20%) — does it contradict existing work?, novelty (15%) — is it new?, specificity (10%) — is it actionable? The weighted composite determines card priority.",
  },
  {
    question: 'how do i add the widget to my site',
    answer: "Add one script tag: <script src=\"https://api.agentintake.io/widget.js?tenant=your-tenant-id\"></script>. That's it. The widget injects the three-layer stack: chat panel (iframe), board overlay (DOM), and connects via WebSocket for real-time updates. No build step, no framework.",
  },
  {
    question: 'what model does this use',
    answer: "The default model is Claude Sonnet 4 (claude-sonnet-4-20250514). Each tenant can configure their preferred model and max token limit. The Forkless pattern library wraps the Anthropic SDK and handles the tool-use loop — call Claude, process tool calls, loop until text response.",
  },
  {
    question: 'is this open source',
    answer: "The Forkless pattern library (forkless/lib/) is open source on GitHub: github.com/pauldiehl/forkless. The serverless service (forkless-service) that makes it multi-tenant is what powers api.agentintake.io. The Agent Intake Protocol spec is also open.",
  },
  {
    question: 'how does auth work',
    answer: "OTP (one-time password) via email. No passwords, no Cognito, no OAuth. You enter your email, get a 6-digit code via SES, enter the code, get a JWT cookie. The JWT includes your tenant_id and trust level. Zero external auth dependencies — just Node.js crypto.",
  },
  {
    question: 'i want forkless how do i start',
    answer: "I can set you up with your own Forkless agent right now — takes about 2 minutes. I just need a few details. Let's start: what's your business or project name?",
  },
];

for (const faq of faqs) {
  await putItem('faq-cache', {
    tenant_id: tenantId,
    question_hash: hashQuestion(faq.question),
    question: faq.question,
    answer: faq.answer,
    hit_count: 5,
    consistent_count: 5,
    crystallized: true,
    created_at: now,
    updated_at: now,
  });
}

console.log(`Seeded ${faqs.length} crystallized FAQ entries for ${tenantId}`);
console.log('Questions:');
for (const faq of faqs) {
  console.log(`  - ${faq.question}`);
}
