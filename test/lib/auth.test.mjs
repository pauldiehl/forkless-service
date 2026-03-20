/**
 * Tests for auth module — JWT, OTP, sessions.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

process.env.FORKLESS_STORAGE = 'local';
process.env.JWT_SECRET = 'test-secret-key';
process.env.TABLE_PREFIX = 'test-forkless';

const {
  createJwt, verifyJwt, generateOtp, storeOtp, verifyOtp,
  createSession, authenticateRequest
} = await import('../../src/lib/auth.mjs');

const DATA_DIR = join(process.cwd(), 'data');

describe('auth', () => {
  before(() => { mkdirSync(DATA_DIR, { recursive: true }); });
  after(() => {
    try { rmSync(join(DATA_DIR, 'otp.json')); } catch {}
    try { rmSync(join(DATA_DIR, 'users.json')); } catch {}
  });

  describe('JWT', () => {
    it('creates and verifies a JWT', () => {
      const token = createJwt({ email: 'test@example.com', tenant_id: 'tenant-1' });
      const payload = verifyJwt(token);
      assert.equal(payload.email, 'test@example.com');
      assert.equal(payload.tenant_id, 'tenant-1');
      assert.ok(payload.iat);
      assert.ok(payload.exp);
    });

    it('rejects invalid token', () => {
      assert.equal(verifyJwt('invalid.token.here'), null);
    });

    it('rejects null/empty token', () => {
      assert.equal(verifyJwt(null), null);
      assert.equal(verifyJwt(''), null);
    });

    it('JWT payload includes tenant_id', () => {
      const token = createJwt({ email: 'a@b.com', tenant_id: 't1', trustLevel: 'admin' });
      const payload = verifyJwt(token);
      assert.equal(payload.tenant_id, 't1');
      assert.equal(payload.trustLevel, 'admin');
    });
  });

  describe('OTP', () => {
    it('generates 6-digit OTP', () => {
      const otp = generateOtp();
      assert.match(otp, /^\d{6}$/);
    });

    it('stores and verifies OTP with tenant scope', async () => {
      await storeOtp('alice@test.com', '123456', 'tenant-a');
      const valid = await verifyOtp('alice@test.com', '123456', 'tenant-a');
      assert.equal(valid, true);
    });

    it('rejects wrong OTP', async () => {
      await storeOtp('bob@test.com', '654321', 'tenant-a');
      const valid = await verifyOtp('bob@test.com', '000000', 'tenant-a');
      assert.equal(valid, false);
    });

    it('rejects used OTP', async () => {
      await storeOtp('carol@test.com', '111111', 'tenant-a');
      await verifyOtp('carol@test.com', '111111', 'tenant-a');
      const valid = await verifyOtp('carol@test.com', '111111', 'tenant-a');
      assert.equal(valid, false);
    });

    it('tenant isolation — same email different tenants', async () => {
      await storeOtp('shared@test.com', '111111', 'tenant-x');
      await storeOtp('shared@test.com', '222222', 'tenant-y');

      const validX = await verifyOtp('shared@test.com', '111111', 'tenant-x');
      const validY = await verifyOtp('shared@test.com', '222222', 'tenant-y');
      assert.equal(validX, true);
      assert.equal(validY, true);
    });
  });

  describe('Sessions', () => {
    it('createSession returns a JWT with tenant_id', async () => {
      const token = await createSession('user@test.com', 'tenant-s');
      const payload = verifyJwt(token);
      assert.equal(payload.email, 'user@test.com');
      assert.equal(payload.tenant_id, 'tenant-s');
      assert.ok(payload.sessionId);
    });
  });

  describe('authenticateRequest', () => {
    it('extracts token from cookie', () => {
      const token = createJwt({ email: 'a@b.com', tenant_id: 't1' });
      const event = { cookies: [`forkless_token=${token}`], headers: {} };
      const user = authenticateRequest(event);
      assert.equal(user.email, 'a@b.com');
    });

    it('extracts token from Authorization header', () => {
      const token = createJwt({ email: 'a@b.com', tenant_id: 't1' });
      const event = { cookies: [], headers: { authorization: `Bearer ${token}` } };
      const user = authenticateRequest(event);
      assert.equal(user.email, 'a@b.com');
    });

    it('returns null for no token', () => {
      const event = { cookies: [], headers: {} };
      assert.equal(authenticateRequest(event), null);
    });
  });
});
