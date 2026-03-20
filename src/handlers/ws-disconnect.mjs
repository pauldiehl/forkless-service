/**
 * WebSocket $disconnect handler.
 * Removes connection record.
 */

import { deleteItem } from '../lib/dynamo.mjs';

export async function handler(event) {
  const connectionId = event.requestContext.connectionId;
  await deleteItem('connections', { connection_id: connectionId });
  return { statusCode: 200, body: 'Disconnected' };
}
