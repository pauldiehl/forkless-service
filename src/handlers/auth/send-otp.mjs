/**
 * POST /auth/send-otp
 * Validates tenant exists + email format, generates OTP, stores with tenant scope, sends via SES.
 */

import { generateOtp, storeOtp, success, error } from '../../lib/auth.mjs';
import { getTenant } from '../../lib/tenant.mjs';
import { sendOtpEmail } from '../../lib/ses.mjs';

export async function handler(event) {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return error('Invalid JSON', 'INVALID_JSON');
  }

  const { email, tenant_id } = body;

  if (!email || !tenant_id) {
    return error('email and tenant_id are required', 'MISSING_FIELDS');
  }

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return error('Invalid email format', 'INVALID_EMAIL');
  }

  // Validate tenant exists
  const tenant = await getTenant(tenant_id);
  if (!tenant) {
    return error('Unknown tenant', 'UNKNOWN_TENANT', 404);
  }

  const otp = generateOtp();
  await storeOtp(email, otp, tenant_id);
  await sendOtpEmail(email, otp, {
    tenantName: tenant.name || 'Forkless',
    fromEmail: tenant.ses_from_email,
    accentColor: tenant.accent_color,
  });

  return success({ sent: true });
}
