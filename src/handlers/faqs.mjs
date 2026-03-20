/**
 * GET /faqs/{tenantId} — Return crystallized FAQ questions for the carousel.
 * Public endpoint (no auth required). Returns just the question text.
 */

import { success, error } from '../lib/auth.mjs';
import { getTenant } from '../lib/tenant.mjs';
import { queryItems } from '../lib/dynamo.mjs';

export async function handler(event) {
  const tenantId = event.pathParameters?.tenantId;
  if (!tenantId) return error('tenant_id is required', 'MISSING_TENANT');

  const tenant = await getTenant(tenantId);
  if (!tenant) return error('Unknown tenant', 'UNKNOWN_TENANT', 404);

  const entries = await queryItems('faq-cache', { pk: 'tenant_id', pkValue: tenantId });
  const faqs = entries
    .filter(f => f.crystallized)
    .map(f => ({ question: f.question }));

  // Derive client WebSocket URL from management API endpoint
  const wsEndpoint = process.env.WS_ENDPOINT || '';
  const wsUrl = wsEndpoint ? wsEndpoint.replace('https://', 'wss://') : null;

  return success({ faqs, tenant_name: tenant.name || tenantId, ws_url: wsUrl });
}
