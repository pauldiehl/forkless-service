#!/usr/bin/env node
/**
 * Seed realistic board cards across all stages for paul-brand.
 * Usage: node scripts/seed-board.mjs
 */

import { putItem } from '../src/lib/dynamo.mjs';

const tenantId = 'paul-brand';
const now = new Date().toISOString();
const hourAgo = new Date(Date.now() - 3600000).toISOString();
const dayAgo = new Date(Date.now() - 86400000).toISOString();
const weekAgo = new Date(Date.now() - 604800000).toISOString();

const cards = [
  // INTAKE — new ideas waiting for triage
  {
    item_id: '1', stage: 'intake', background: 'default',
    title: 'Voice interface for agent chat',
    description: 'Add speech-to-text and text-to-speech so users can talk to the agent instead of typing. Critical for mobile and accessibility.',
    created_at: hourAgo, stage_entered_at: hourAgo,
  },
  {
    item_id: '2', stage: 'intake', background: 'journey',
    title: 'Customer journey: First-time visitor onboarding',
    description: 'Design the first 60 seconds of a new visitor landing on pauldiehl.github.io. What does the agent say? When does the board appear?',
    created_at: hourAgo, stage_entered_at: hourAgo,
  },

  // QUALIFIED — worth building, need grooming
  {
    item_id: '3', stage: 'qualified', background: 'default',
    title: 'FAQ crystallization dashboard',
    description: 'Admin view showing which questions have crystallized, hit counts, and cost savings from cached answers.',
    merit_score: 0.82,
    created_at: dayAgo, stage_entered_at: dayAgo,
  },

  // GROOMING — being refined
  {
    item_id: '4', stage: 'grooming', background: 'info',
    title: 'Multi-tenant billing tracking',
    description: 'Track Claude API token usage per tenant per month. No billing yet — just tracking. Show in admin stats.',
    merit_score: 0.75,
    created_at: dayAgo, stage_entered_at: dayAgo,
  },

  // BUILDING — actively being built
  {
    item_id: '5', stage: 'building', background: 'active',
    title: 'Forkless Service — serverless deployment',
    description: 'SAM template, Lambda functions, DynamoDB tables, widget. The whole multi-tenant stack.',
    merit_score: 0.95,
    assigned_to: 'claude-agent',
    created_at: weekAgo, stage_entered_at: dayAgo,
  },
  {
    item_id: '6', stage: 'building', background: 'active',
    title: 'Widget iframe chat + DOM board overlay',
    description: 'Three-layer UI injector. Chat in iframe (CSS isolation). Board as transparent DOM overlay with high z-index.',
    merit_score: 0.90,
    assigned_to: 'claude-agent',
    created_at: weekAgo, stage_entered_at: dayAgo,
  },

  // VALIDATE — built, awaiting review
  {
    item_id: '7', stage: 'validate', background: 'urgent',
    title: 'AIP Registry agent discovery',
    description: 'Agents can register at agentintake.io and discover other agents. Working: registration, search, badge generation.',
    merit_score: 0.88,
    artifact_url: 'https://agentintake.io',
    created_at: weekAgo, stage_entered_at: dayAgo,
  },

  // DONE — shipped
  {
    item_id: '8', stage: 'done', background: 'done',
    title: 'Forkless pattern library',
    description: 'Complete library: agent (Claude wrapper, conversation, prompts), planning (board, coordinator, cards, display modes), transaction (artifacts).',
    merit_score: 0.92,
    created_at: weekAgo, stage_entered_at: weekAgo,
  },
  {
    item_id: '9', stage: 'done', background: 'done',
    title: 'OTP + JWT auth (zero deps)',
    description: 'Authentication using Node.js built-in crypto. No jsonwebtoken, no passport. HMAC-SHA256 JWT, 6-digit OTP via SES.',
    merit_score: 0.85,
    created_at: weekAgo, stage_entered_at: weekAgo,
  },
  {
    item_id: '10', stage: 'done', background: 'done',
    title: 'Three-layer architecture spec',
    description: 'Agent (sequential) + Planning/Driftboard (spatial) + Transaction (product). Agent is always on top. The AI is the interface.',
    merit_score: 0.95,
    created_at: weekAgo, stage_entered_at: weekAgo,
  },
];

// Seed comments demonstrating the pattern
const comments = [
  {
    comment_id: '5-0', card_id: 5, author: 'paul@agentintake.io',
    body: 'This is the priority. Everything else depends on getting the service deployed.',
    intent: 'general', created_at: dayAgo,
  },
  {
    comment_id: '7-0', card_id: 7, author: 'paul@agentintake.io',
    body: 'LGTM — registry is working in production. Badge SVGs render correctly.',
    intent: 'validation', created_at: dayAgo,
  },
  {
    comment_id: '4-0', card_id: 4, author: 'agent',
    body: 'Needs clarification: should we track input tokens and output tokens separately, or just total? Also, should we track per-conversation or per-tenant aggregate?',
    intent: 'grooming', created_at: dayAgo,
  },
];

// Write all items
for (const card of cards) {
  await putItem('board-items', { tenant_id: tenantId, ...card });
}

for (const comment of comments) {
  await putItem('board-comments', { tenant_id: tenantId, ...comment });
}

console.log(`Seeded ${cards.length} board cards for ${tenantId}`);
console.log(`Seeded ${comments.length} comments`);
console.log('Stages:');
const stages = {};
for (const card of cards) {
  stages[card.stage] = (stages[card.stage] || 0) + 1;
}
for (const [stage, count] of Object.entries(stages)) {
  console.log(`  ${stage}: ${count}`);
}
