/**
 * Tests for auth handlers — full OTP flow with mock events.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

process.env.FORKLESS_STORAGE = 'local';
process.env.JWT_SECRET = 'test-secret-key';
process.env.TABLE_PREFIX = 'test-forkless';

const { putItem } = await import('../../src/lib/dynamo.mjs');
const { verifyJwt } = await import('../../src/lib/auth.mjs');

const DATA_DIR = join(process.cwd(), 'data');

describe('auth handlers', () => {
  before(async () => {
    mkdirSync(DATA_DIR, { recursive: true });
    // Seed test tenant
    await putItem('tenants', {
      tenant_id: 'test-tenant',
      name: 'Test Co',
      admin_users: ['admin@test.com'],
    });
  });

  after(() => {
    try { rmSync(join(DATA_DIR, 'tenants.json')); } catch {}
    try { rmSync(join(DATA_DIR, 'otp.json')); } catch {}
    try { rmSync(join(DATA_DIR, 'users.json')); } catch {}
  });

  it('send-otp rejects missing fields', async () => {
    const { handler } = await import('../../src/handlers/auth/send-otp.mjs');
    const res = await handler({ body: JSON.stringify({ email: 'a@b.com' }) });
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.code, 'MISSING_FIELDS');
  });

  it('send-otp rejects unknown tenant', async () => {
    const { handler } = await import('../../src/handlers/auth/send-otp.mjs');
    const res = await handler({
      body: JSON.stringify({ email: 'a@b.com', tenant_id: 'fake' }),
    });
    assert.equal(res.statusCode, 404);
  });

  it('send-otp succeeds for valid tenant', async () => {
    const { handler } = await import('../../src/handlers/auth/send-otp.mjs');
    const res = await handler({
      body: JSON.stringify({ email: 'user@test.com', tenant_id: 'test-tenant' }),
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.data.sent, true);
  });

  it('verify-otp rejects wrong code', async () => {
    const { handler } = await import('../../src/handlers/auth/verify-otp.mjs');
    const res = await handler({
      body: JSON.stringify({ email: 'user@test.com', otp: '000000', tenant_id: 'test-tenant' }),
    });
    assert.equal(res.statusCode, 401);
  });

  it('full OTP flow: send -> verify -> get JWT', async () => {
    const { storeOtp } = await import('../../src/lib/auth.mjs');
    await storeOtp('flow@test.com', '999999', 'test-tenant');

    const { handler } = await import('../../src/handlers/auth/verify-otp.mjs');
    const res = await handler({
      body: JSON.stringify({ email: 'flow@test.com', otp: '999999', tenant_id: 'test-tenant' }),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.data.authenticated, true);

    // Verify token in response body (for cross-origin widget)
    assert.ok(body.data.token, 'token should be in response body');
    const bodyPayload = verifyJwt(body.data.token);
    assert.equal(bodyPayload.email, 'flow@test.com');
    assert.equal(bodyPayload.tenant_id, 'test-tenant');

    // Verify cookie was also set
    assert.ok(res.cookies);
    assert.ok(res.cookies[0].startsWith('forkless_token='));

    // Extract and verify JWT from cookie
    const token = res.cookies[0].split('=')[1].split(';')[0];
    const payload = verifyJwt(token);
    assert.equal(payload.email, 'flow@test.com');
    assert.equal(payload.tenant_id, 'test-tenant');
  });

  it('admin user gets admin trustLevel', async () => {
    const { storeOtp } = await import('../../src/lib/auth.mjs');
    await storeOtp('admin@test.com', '888888', 'test-tenant');

    const { handler } = await import('../../src/handlers/auth/verify-otp.mjs');
    const res = await handler({
      body: JSON.stringify({ email: 'admin@test.com', otp: '888888', tenant_id: 'test-tenant' }),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.data.trustLevel, 'admin');
  });

  it('logout clears cookie', async () => {
    const { handler } = await import('../../src/handlers/auth/logout.mjs');
    const res = await handler({ cookies: [], headers: {} });
    assert.equal(res.statusCode, 200);
    assert.ok(res.cookies[0].includes('Max-Age=0'));
  });
});
