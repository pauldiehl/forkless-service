/**
 * WebSocket $connect handler.
 * Verifies JWT from query string, stores connection record.
 */

import { verifyJwt } from '../lib/auth.mjs';
import { putItem } from '../lib/dynamo.mjs';

export async function handler(event) {
  const connectionId = event.requestContext.connectionId;
  const qs = event.queryStringParameters || {};
  const token = qs.token;

  // Verify JWT (optional — anonymous connections allowed for public boards)
  let user = null;
  if (token) {
    user = verifyJwt(token);
  }

  const now = Math.floor(Date.now() / 1000);

  await putItem('connections', {
    connection_id: connectionId,
    tenant_id: user?.tenant_id || qs.tenant_id || null,
    email: user?.email || null,
    trust_level: user?.trustLevel || 'viewer',
    channels: [],
    connected_at: new Date().toISOString(),
    ttl: now + 86400, // 24 hour TTL
  });

  return { statusCode: 200, body: 'Connected' };
}
