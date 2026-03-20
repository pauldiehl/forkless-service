/**
 * Tests for admin handlers — stats, conversations, config, refresh-knowledge.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

process.env.FORKLESS_STORAGE = 'local';
process.env.JWT_SECRET = 'test-secret-key';
process.env.TABLE_PREFIX = 'test-forkless';

const { putItem } = await import('../../src/lib/dynamo.mjs');
const { createJwt } = await import('../../src/lib/auth.mjs');

const DATA_DIR = join(process.cwd(), 'data');
const TENANT_ID = 'admin-test';

function makeAdminHeaders(tenantId = TENANT_ID) {
  const token = createJwt({ email: 'admin@test.com', tenant_id: tenantId, trustLevel: 'admin' });
  return { authorization: `Bearer ${token}` };
}

function makeEvent(overrides = {}) {
  return {
    body: '{}',
    cookies: [],
    headers: makeAdminHeaders(),
    pathParameters: {},
    requestContext: { http: { method: 'GET', path: '/admin/' } },
    ...overrides,
  };
}

describe('admin handlers', () => {
  before(async () => {
    mkdirSync(DATA_DIR, { recursive: true });
    await putItem('tenants', {
      tenant_id: TENANT_ID,
      name: 'Admin Test',
      description: 'Test tenant for admin.',
      admin_users: ['admin@test.com'],
      system_prompt: 'You are a test agent.',
    });
    // Seed a conversation
    await putItem('conversations', {
      tenant_id: TENANT_ID,
      conversation_id: 'conv-001',
      email: 'user@test.com',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  });

  after(() => {
    try { rmSync(join(DATA_DIR, 'tenants.json')); } catch {}
    try { rmSync(join(DATA_DIR, 'conversations.json')); } catch {}
    try { rmSync(join(DATA_DIR, 'faq-cache.json')); } catch {}
    try { rmSync(join(DATA_DIR, 'journey-states.json')); } catch {}
  });

  it('rejects unauthenticated requests', async () => {
    const { handler } = await import('../../src/handlers/admin.mjs');
    const res = await handler(makeEvent({
      headers: {},
      pathParameters: { tenantId: TENANT_ID },
    }));
    assert.equal(res.statusCode, 401);
  });

  it('rejects non-admin users', async () => {
    const { handler } = await import('../../src/handlers/admin.mjs');
    const token = createJwt({ email: 'user@test.com', tenant_id: TENANT_ID, trustLevel: 'registered' });
    const res = await handler(makeEvent({
      headers: { authorization: `Bearer ${token}` },
      pathParameters: { tenantId: TENANT_ID },
    }));
    assert.equal(res.statusCode, 403);
  });

  it('GET /admin/{tenantId} returns stats', async () => {
    const { handler } = await import('../../src/handlers/admin.mjs');
    const res = await handler(makeEvent({
      pathParameters: { tenantId: TENANT_ID },
    }));
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.data.tenant_id, TENANT_ID);
    assert.ok(body.data.stats);
    assert.equal(body.data.stats.conversations, 1);
  });

  it('GET /admin/{tenantId}/conversations returns conversation list', async () => {
    const { handler } = await import('../../src/handlers/admin.mjs');
    const res = await handler(makeEvent({
      pathParameters: { tenantId: `${TENANT_ID}/conversations` },
    }));
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.data.conversations));
    assert.equal(body.data.conversations.length, 1);
    const conv = body.data.conversations[0];
    assert.equal(conv.conversation_id, 'conv-001');
    assert.equal(conv.email, 'user@test.com');
    assert.equal(conv.message_count, 2);
    assert.ok(conv.preview.includes('Hi there'));
  });

  it('POST /admin/config updates tenant settings', async () => {
    const { handler } = await import('../../src/handlers/admin.mjs');
    const res = await handler(makeEvent({
      requestContext: { http: { method: 'POST', path: '/admin/config' } },
      body: JSON.stringify({
        tenant_id: TENANT_ID,
        updates: { greeting: 'Updated greeting!', board_enabled: true },
      }),
    }));
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.data.updated, true);
  });

  it('POST /admin/config rejects disallowed fields', async () => {
    const { handler } = await import('../../src/handlers/admin.mjs');
    const res = await handler(makeEvent({
      requestContext: { http: { method: 'POST', path: '/admin/config' } },
      body: JSON.stringify({
        tenant_id: TENANT_ID,
        updates: { secret_key: 'hacked' },
      }),
    }));
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.code, 'NO_VALID_FIELDS');
  });

  it('POST /admin/refresh-knowledge rejects tenant with no sources', async () => {
    const { handler } = await import('../../src/handlers/admin.mjs');
    const res = await handler(makeEvent({
      requestContext: { http: { method: 'POST', path: '/admin/refresh-knowledge' } },
      body: JSON.stringify({ tenant_id: TENANT_ID }),
    }));
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.code, 'NO_SOURCES');
  });
});
