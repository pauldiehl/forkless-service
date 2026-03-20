/**
 * Tests for chat handler.
 * Uses local mode — tests the flow without real Claude API calls.
 * Auth-required, rate-limiting, and FAQ cache bypass tested.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

process.env.FORKLESS_STORAGE = 'local';
process.env.JWT_SECRET = 'test-secret-key';
process.env.TABLE_PREFIX = 'test-forkless';
process.env.CHAT_RATE_LIMIT = '3'; // Low limit for testing

const { putItem } = await import('../../src/lib/dynamo.mjs');
const { recordAnswer } = await import('../../src/lib/faq.mjs');
const { createJwt } = await import('../../src/lib/auth.mjs');

const DATA_DIR = join(process.cwd(), 'data');

function makeAuthHeaders(email = 'user@test.com', tenantId = 'chat-test') {
  const token = createJwt({ email, tenant_id: tenantId, trustLevel: 'registered' });
  return {
    authorization: `Bearer ${token}`,
  };
}

function makeEvent(body, headers = {}) {
  return {
    body: JSON.stringify(body),
    cookies: [],
    headers,
  };
}

describe('chat handler', () => {
  before(async () => {
    mkdirSync(DATA_DIR, { recursive: true });
    // Seed test tenant
    await putItem('tenants', {
      tenant_id: 'chat-test',
      name: 'Chat Test',
      description: 'Test tenant for chat',
      system_prompt: 'You are a test assistant.',
    });
  });

  after(() => {
    try { rmSync(join(DATA_DIR, 'tenants.json')); } catch {}
    try { rmSync(join(DATA_DIR, 'conversations.json')); } catch {}
    try { rmSync(join(DATA_DIR, 'faq-cache.json')); } catch {}
    try { rmSync(join(DATA_DIR, 'otp.json')); } catch {}
  });

  it('rejects missing message', async () => {
    const { handler } = await import('../../src/handlers/chat.mjs');
    const res = await handler(makeEvent(
      { tenant_id: 'chat-test' },
      makeAuthHeaders(),
    ));
    assert.equal(res.statusCode, 400);
  });

  it('rejects missing tenant_id', async () => {
    const { handler } = await import('../../src/handlers/chat.mjs');
    const res = await handler(makeEvent(
      { message: 'hello' },
      makeAuthHeaders(),
    ));
    assert.equal(res.statusCode, 400);
  });

  it('rejects unknown tenant', async () => {
    const { handler } = await import('../../src/handlers/chat.mjs');
    const res = await handler(makeEvent(
      { message: 'hello', tenant_id: 'nonexistent' },
      makeAuthHeaders('user@test.com', 'nonexistent'),
    ));
    assert.equal(res.statusCode, 404);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const { handler } = await import('../../src/handlers/chat.mjs');
    const res = await handler(makeEvent(
      { message: 'hello', tenant_id: 'chat-test' },
    ));
    assert.equal(res.statusCode, 401);
    const body = JSON.parse(res.body);
    assert.equal(body.code, 'AUTH_REQUIRED');
  });

  it('returns FAQ cache hit without LLM call and persists conversation', async () => {
    // Pre-crystallize a FAQ — answers must be >60% similar (word overlap after punctuation strip)
    await recordAnswer('chat-test', 'test question', 'Web 4.0 is the trust economy era of the internet where agents represent people');
    await recordAnswer('chat-test', 'test question', 'Web 4.0 is the trust economy era of the internet where agents represent businesses');
    await recordAnswer('chat-test', 'test question', 'Web 4.0 is the trust economy era of the internet where agents represent users');

    const { handler } = await import('../../src/handlers/chat.mjs');
    const res = await handler(makeEvent(
      { message: 'test question', tenant_id: 'chat-test' },
      makeAuthHeaders(),
    ));

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.data.source, 'faq_cache');
    assert.ok(body.data.reply.includes('trust economy'));
    // Authenticated FAQ hits return a conversation_id for context continuity
    assert.ok(body.data.conversation_id, 'should return conversation_id');
  });

  it('returns FAQ cache hit WITHOUT auth (no 401 for FAQ)', async () => {
    // The FAQ was already crystallized by the previous test.
    // Send the same question with NO auth headers — should still return FAQ hit.
    const { handler } = await import('../../src/handlers/chat.mjs');
    const res = await handler(makeEvent(
      { message: 'test question', tenant_id: 'chat-test' },
      // No auth headers
    ));

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.data.source, 'faq_cache');
    assert.ok(body.data.reply.includes('trust economy'));
  });

  it('enforces rate limit per-email per-day', async () => {
    const { handler } = await import('../../src/handlers/chat.mjs');
    const email = 'ratelimit@test.com';
    const headers = makeAuthHeaders(email);

    // Seed rate counter near limit (limit is 3 for tests)
    const today = new Date().toISOString().slice(0, 10);
    const rateLimitKey = `rate-${email}-${today}`;
    await putItem('otp', {
      tenant_id: 'chat-test',
      email: rateLimitKey,
      count: 3,
      ttl: Math.floor(Date.now() / 1000) + 86400,
    });

    // This request should be rate limited
    const res = await handler(makeEvent(
      { message: 'should be limited', tenant_id: 'chat-test' },
      headers,
    ));

    assert.equal(res.statusCode, 429);
    const body = JSON.parse(res.body);
    assert.equal(body.code, 'RATE_LIMITED');
  });
});
