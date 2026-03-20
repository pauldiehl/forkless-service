/**
 * Tests for system prompt builder — domain guardrails.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.FORKLESS_STORAGE = 'local';

const { buildTenantPrompt } = await import('../../src/prompts/system.mjs');

describe('buildTenantPrompt', () => {
  const tenant = {
    tenant_id: 'test-brand',
    name: 'Test Co',
    description: 'Widget manufacturing company. We make the best widgets.',
    system_prompt: 'We sell widgets in 3 sizes: small, medium, large.',
  };

  it('includes domain guardrails section in fallback path', () => {
    const prompt = buildTenantPrompt(tenant);
    assert.ok(prompt.includes('## Domain Guardrails'));
    assert.ok(prompt.includes('domain-specific knowledge agent for Test Co'));
    assert.ok(prompt.includes('Widget manufacturing company'));
    assert.ok(prompt.includes('Never fabricate information'));
    assert.ok(prompt.includes('Never pivot to general-purpose'));
  });

  it('uses first sentence of description as descShort', () => {
    const prompt = buildTenantPrompt(tenant);
    assert.ok(prompt.includes("I'm here to help with Widget manufacturing company"));
    // Should NOT include the second sentence
    assert.ok(!prompt.includes("I'm here to help with Widget manufacturing company. We make"));
  });

  it('falls back to tenant name when no description', () => {
    const prompt = buildTenantPrompt({ ...tenant, description: '' });
    assert.ok(prompt.includes("I'm here to help with Test Co"));
  });

  it('includes knowledge section', () => {
    const prompt = buildTenantPrompt(tenant);
    // Forkless path uses "Tenant Knowledge", fallback uses "Knowledge"
    assert.ok(prompt.includes('Knowledge'));
    assert.ok(prompt.includes('widgets in 3 sizes'));
  });

  it('includes FAQ section when provided', () => {
    const prompt = buildTenantPrompt(tenant, {
      faqSummary: [{ question: 'What sizes?', answer: 'Small, medium, large.' }],
    });
    assert.ok(prompt.includes('## Known FAQ'));
    assert.ok(prompt.includes('What sizes?'));
  });
});
