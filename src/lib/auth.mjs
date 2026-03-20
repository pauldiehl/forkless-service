/**
 * Auth utilities — JWT + OTP, tenant-scoped.
 * Adapted from aip-registry/src/lib/auth.mjs.
 * Key differences: OTP keyed by {tenant_id, email}, JWT includes tenant_id + trustLevel.
 */

import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { getItem, putItem, updateItem } from './dynamo.mjs';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRY_HOURS = parseInt(process.env.JWT_EXPIRY || '24', 10);

// ─── JWT (HMAC-SHA256, no external deps) ────────────────────────

function base64url(str) {
  return Buffer.from(str).toString('base64url');
}

function base64urlDecode(str) {
  return Buffer.from(str, 'base64url').toString('utf-8');
}

export function createJwt(payload) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = base64url(JSON.stringify({
    ...payload,
    iat: now,
    exp: now + JWT_EXPIRY_HOURS * 3600,
  }));
  const signature = createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifyJwt(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, signature] = parts;
  const expected = createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');

  if (signature !== expected) return null;

  const payload = JSON.parse(base64urlDecode(body));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
}

// ─── Auth middleware ────────────────────────────────────────────

/**
 * Extract and verify JWT from httpOnly cookie or Authorization header.
 * Returns user payload (with tenant_id) or null.
 */
export function authenticateRequest(event) {
  let token = null;

  // Try cookie first
  const cookies = event.cookies || [];
  for (const cookie of cookies) {
    if (cookie.startsWith('forkless_token=')) {
      token = cookie.split('=')[1];
      break;
    }
  }

  // Fall back to Authorization header
  if (!token) {
    const auth = event.headers?.authorization || event.headers?.Authorization || '';
    if (auth.startsWith('Bearer ')) {
      token = auth.slice(7);
    }
  }

  if (!token) return null;
  return verifyJwt(token);
}

export function requireAuth(event) {
  const user = authenticateRequest(event);
  if (!user) return null;
  return user;
}

// ─── OTP (tenant-scoped) ───────────────────────────────────────

export function generateOtp() {
  return String(randomInt(100000, 999999));
}

export async function storeOtp(email, otp, tenantId) {
  const now = Math.floor(Date.now() / 1000);
  await putItem('otp', {
    tenant_id: tenantId,
    email,
    otp_code: otp,
    created_at: now,
    ttl: now + 600, // 10 minutes
    used: false,
  });
}

export async function verifyOtp(email, otp, tenantId) {
  const record = await getItem('otp', { tenant_id: tenantId, email });
  if (!record) return false;
  if (record.used) return false;
  if (record.otp_code !== otp) return false;

  const now = Math.floor(Date.now() / 1000);
  if (record.ttl && record.ttl < now) return false;

  // Mark as used
  await putItem('otp', { ...record, used: true });
  return true;
}

// ─── Sessions (tenant-scoped) ──────────────────────────────────

export async function createSession(email, tenantId, trustLevel = 'registered') {
  const sessionId = randomUUID();
  const now = new Date().toISOString();

  const existing = await getItem('users', { tenant_id: tenantId, email });
  if (existing) {
    await updateItem('users', { tenant_id: tenantId, email }, {
      last_login: now,
      jwt_session_id: sessionId,
    });
  } else {
    await putItem('users', {
      tenant_id: tenantId,
      email,
      trust_level: trustLevel,
      created_at: now,
      last_login: now,
      jwt_session_id: sessionId,
    });
  }

  const token = createJwt({ email, sessionId, tenant_id: tenantId, trustLevel });
  return token;
}

// ─── Response helpers ───────────────────────────────────────────

export function success(data, statusCode = 200, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify({ data }),
  };
}

export function error(message, code, statusCode = 400) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: message, code }),
  };
}

export function withCookie(response, name, value, opts = {}) {
  const maxAge = opts.maxAge ?? 86400;
  const parts = [`${name}=${value}`, 'HttpOnly', 'SameSite=None', 'Path=/'];
  if (maxAge <= 0) parts.push('Max-Age=0');
  else parts.push(`Max-Age=${maxAge}`);
  if (process.env.FORKLESS_STORAGE !== 'local') parts.push('Secure');
  response.cookies = [parts.join('; ')];
  return response;
}
