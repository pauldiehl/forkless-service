/**
 * GET /artifacts/{id} — Returns pre-rendered HTML artifact.
 * Content-Type: text/html for direct browser rendering.
 */

import { error } from '../lib/auth.mjs';
import { getArtifact } from '../lib/dynamo-artifacts.mjs';

export async function handler(event) {
  const artifactId = event.pathParameters?.id;
  if (!artifactId) return error('Artifact ID required', 'MISSING_ID');

  // Tenant from query string
  const tenantId = event.queryStringParameters?.tenant_id;
  if (!tenantId) return error('tenant_id query param required', 'MISSING_TENANT');

  const artifact = await getArtifact(tenantId, artifactId);
  if (!artifact) {
    return error('Artifact not found', 'NOT_FOUND', 404);
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
    body: artifact.content_html || `<html><body><h1>${artifact.title || 'Artifact'}</h1><p>No content.</p></body></html>`,
  };
}
