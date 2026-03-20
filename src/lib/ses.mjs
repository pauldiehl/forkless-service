/**
 * SES email client — sends OTP emails in production, logs to console locally.
 * Adapted from aip-registry/src/lib/ses.mjs, rebranded for Forkless.
 */

const isLocal = (process.env.FORKLESS_STORAGE || 'local') === 'local';

let sesClient = null;

async function getSES() {
  if (sesClient) return sesClient;
  const { SESClient } = await import('@aws-sdk/client-ses');
  sesClient = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });
  return sesClient;
}

/**
 * Send an OTP email to the given address.
 * @param {string} email - Recipient email
 * @param {string} otp - 6-digit OTP code
 * @param {Object} [opts] - Branding options
 * @param {string} [opts.tenantName='Forkless'] - Tenant display name
 * @param {string} [opts.fromEmail] - Custom SES sender (must be verified in SES)
 * @param {string} [opts.accentColor='#e8735a'] - Brand accent color for HTML template
 */
export async function sendOtpEmail(email, otp, opts = {}) {
  // Support legacy 3rd-arg string for backwards compat
  if (typeof opts === 'string') opts = { tenantName: opts };
  const { tenantName = 'Forkless', fromEmail, accentColor = '#e8735a' } = opts;
  const from = fromEmail || process.env.SES_FROM_EMAIL || 'auth@agentintake.io';
  const subject = `Your ${tenantName} verification code: ${otp}`;
  const body = `
Your verification code is: ${otp}

This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.

— ${tenantName} (powered by Forkless)
`.trim();

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h2 style="color: ${accentColor}; margin: 0;">${tenantName}</h2>
    <p style="color: #666; margin: 4px 0 0;">powered by Forkless</p>
  </div>
  <div style="background: #f8f9fa; border-radius: 12px; padding: 32px; text-align: center;">
    <p style="color: #333; margin: 0 0 16px; font-size: 16px;">Your verification code:</p>
    <div style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: ${accentColor}; font-family: monospace;">${otp}</div>
    <p style="color: #999; margin: 16px 0 0; font-size: 13px;">Expires in 10 minutes</p>
  </div>
  <p style="color: #999; font-size: 12px; text-align: center; margin-top: 24px;">
    If you didn't request this code, you can safely ignore this email.
  </p>
</body>
</html>`.trim();

  if (isLocal) {
    console.log(`\nOTP Email to ${email}`);
    console.log(`   Code: ${otp}`);
    console.log(`   Tenant: ${tenantName}`);
    console.log(`   From: ${from}`);
    console.log(`   (local mode — not actually sent)\n`);
    return;
  }

  const { SendEmailCommand } = await import('@aws-sdk/client-ses');
  const ses = await getSES();
  await ses.send(new SendEmailCommand({
    Source: from,
    Destination: { ToAddresses: [email] },
    Message: {
      Subject: { Data: subject },
      Body: {
        Text: { Data: body },
        Html: { Data: html },
      },
    },
  }));
}
