/**
 * WebSocket $default handler.
 * Parses subscribe/unsubscribe actions, updates channel subscriptions.
 */

import { getItem, putItem } from '../lib/dynamo.mjs';

export async function handler(event) {
  const connectionId = event.requestContext.connectionId;

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { action, channel } = body;

  // Return connection ID for streaming support
  if (action === 'identify') {
    const { pushToConnection } = await import('../lib/ws-push.mjs');
    await pushToConnection(connectionId, { connection_id: connectionId });
    return { statusCode: 200, body: 'ok' };
  }

  if (!channel) {
    return { statusCode: 400, body: 'channel required' };
  }

  const conn = await getItem('connections', { connection_id: connectionId });
  if (!conn) {
    return { statusCode: 410, body: 'Connection not found' };
  }

  const channels = conn.channels || [];

  if (action === 'subscribe') {
    if (!channels.includes(channel)) {
      channels.push(channel);
    }
  } else if (action === 'unsubscribe') {
    const idx = channels.indexOf(channel);
    if (idx >= 0) channels.splice(idx, 1);
  }

  await putItem('connections', { ...conn, channels });

  return { statusCode: 200, body: JSON.stringify({ channels }) };
}
