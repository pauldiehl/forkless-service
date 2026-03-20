/**
 * Journey states DynamoDB adapter.
 * Tracks user journey state machines.
 */

import { getItem, putItem, queryItems } from './dynamo.mjs';

export async function getJourney(tenantId, journeyId) {
  return getItem('journey-states', { tenant_id: tenantId, journey_id: journeyId });
}

export async function putJourney(tenantId, journey) {
  return putItem('journey-states', {
    tenant_id: tenantId,
    ...journey,
    updated_at: new Date().toISOString(),
  });
}

export async function listJourneys(tenantId, limit = 50) {
  return queryItems('journey-states', {
    pk: 'tenant_id',
    pkValue: tenantId,
    scanForward: false,
    limit,
  });
}
