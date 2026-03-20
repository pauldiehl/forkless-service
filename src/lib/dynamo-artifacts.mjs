/**
 * Artifacts DynamoDB adapter.
 * CRUD for pre-rendered HTML artifacts.
 */

import { getItem, putItem, queryItems, deleteItem } from './dynamo.mjs';

export async function getArtifact(tenantId, artifactId) {
  return getItem('artifacts', { tenant_id: tenantId, artifact_id: artifactId });
}

export async function putArtifact(tenantId, artifact) {
  return putItem('artifacts', {
    tenant_id: tenantId,
    ...artifact,
    updated_at: new Date().toISOString(),
  });
}

export async function listArtifacts(tenantId, limit = 50) {
  return queryItems('artifacts', {
    pk: 'tenant_id',
    pkValue: tenantId,
    scanForward: false,
    limit,
  });
}

export async function removeArtifact(tenantId, artifactId) {
  return deleteItem('artifacts', { tenant_id: tenantId, artifact_id: artifactId });
}
