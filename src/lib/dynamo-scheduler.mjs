/**
 * Scheduler events DynamoDB adapter.
 * Manages scheduled callbacks (send_message, create_artifact, chain events).
 * Uses fire-at-index GSI to query events due for execution.
 */

import { getItem, putItem, queryItems, deleteItem, updateItem } from './dynamo.mjs';

export async function getEvent(tenantId, eventId) {
  return getItem('scheduler-events', { tenant_id: tenantId, event_id: eventId });
}

export async function putEvent(tenantId, event) {
  return putItem('scheduler-events', {
    tenant_id: tenantId,
    ...event,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Get events due for execution.
 * Queries fire-at-index GSI for events where fire_at <= now and status = 'pending'.
 */
export async function getDueEvents(tenantId) {
  const now = new Date().toISOString();
  const events = await queryItems('scheduler-events', {
    pk: 'tenant_id',
    pkValue: tenantId,
    index: 'fire-at-index',
  });
  // Filter for pending events that are due
  return events.filter(e => e.status === 'pending' && e.fire_at <= now);
}

export async function markCompleted(tenantId, eventId) {
  return updateItem('scheduler-events', { tenant_id: tenantId, event_id: eventId }, {
    status: 'completed',
    completed_at: new Date().toISOString(),
  });
}

export async function listEvents(tenantId, limit = 50) {
  return queryItems('scheduler-events', {
    pk: 'tenant_id',
    pkValue: tenantId,
    scanForward: false,
    limit,
  });
}

export async function removeEvent(tenantId, eventId) {
  return deleteItem('scheduler-events', { tenant_id: tenantId, event_id: eventId });
}
