/**
 * POST /auth/verify-otp
 * Verifies OTP (tenant-scoped), creates session, returns JWT with tenant_id + trustLevel.
 */

import { verifyOtp, createSession, success, error, withCookie } from '../../lib/auth.mjs';
import { getTenant } from '../../lib/tenant.mjs';

export async function handler(event) {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return error('Invalid JSON', 'INVALID_JSON');
  }

  const { email, otp, tenant_id } = body;

  if (!email || !otp || !tenant_id) {
    return error('email, otp, and tenant_id are required', 'MISSING_FIELDS');
  }

  // Validate tenant exists
  const tenant = await getTenant(tenant_id);
  if (!tenant) {
    return error('Unknown tenant', 'UNKNOWN_TENANT', 404);
  }

  const valid = await verifyOtp(email, otp, tenant_id);
  if (!valid) {
    return error('Invalid or expired code', 'INVALID_OTP', 401);
  }

  // Determine trust level — admin if email is in tenant's admin list
  const adminEmails = tenant.admin_users || [];
  const trustLevel = adminEmails.includes(email) ? 'admin' : 'registered';

  const token = await createSession(email, tenant_id, trustLevel);

  const response = success({ authenticated: true, trustLevel, token });
  return withCookie(response, 'forkless_token', token, { maxAge: 86400 });
}
