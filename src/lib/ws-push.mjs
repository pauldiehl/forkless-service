/**
 * WebSocket broadcast utility.
 * Queries connections by tenant, POSTs to each via API Gateway Management API.
 */

import { scanItems, deleteItem } from './dynamo.mjs';

let apiGwClient = null;

async function getApiGwClient() {
  if (apiGwClient) return apiGwClient;
  const { ApiGatewayManagementApiClient } = await import('@aws-sdk/client-apigatewaymanagementapi');
  const endpoint = process.env.WS_ENDPOINT;
  if (!endpoint) return null;
  apiGwClient = new ApiGatewayManagementApiClient({
    endpoint,
    region: process.env.AWS_REGION || 'us-east-1',
  });
  return apiGwClient;
}

/**
 * Broadcast a message to all connections for a tenant on a specific channel.
 */
export async function broadcastToTenant(tenantId, channel, message) {
  const client = await getApiGwClient();
  if (!client) return;

  const { PostToConnectionCommand } = await import('@aws-sdk/client-apigatewaymanagementapi');

  // Get all connections for this tenant
  const { items: connections } = await scanItems('connections', {
    filterField: 'tenant_id',
    filterValue: tenantId,
  });

  const payload = JSON.stringify({
    channel,
    tenant_id: tenantId,
    ...message,
  });

  const sends = connections
    .filter(conn => (conn.channels || []).includes(channel))
    .map(async (conn) => {
      try {
        await client.send(new PostToConnectionCommand({
          ConnectionId: conn.connection_id,
          Data: payload,
        }));
      } catch (err) {
        // Connection is stale — remove it
        if (err.statusCode === 410 || err.$metadata?.httpStatusCode === 410) {
          await deleteItem('connections', { connection_id: conn.connection_id });
        }
      }
    });

  await Promise.all(sends);
}

/**
 * Push a message to a specific WebSocket connection.
 * @param {string} connectionId - WebSocket connection ID
 * @param {Object} message - Message payload
 * @returns {boolean} true if sent, false if connection is stale
 */
export async function pushToConnection(connectionId, message) {
  const client = await getApiGwClient();
  if (!client) return false;

  const { PostToConnectionCommand } = await import('@aws-sdk/client-apigatewaymanagementapi');
  const payload = JSON.stringify(message);

  try {
    await client.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: payload,
    }));
    return true;
  } catch (err) {
    if (err.statusCode === 410 || err.$metadata?.httpStatusCode === 410) {
      await deleteItem('connections', { connection_id: connectionId });
    }
    return false;
  }
}
