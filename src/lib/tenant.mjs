/**
 * Tenant config loader with in-memory cache.
 * Caches tenant records for 5 minutes in warm Lambda invocations.
 */

import { getItem } from './dynamo.mjs';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map();

/**
 * Get tenant config by ID. Returns null if not found.
 * Cached for 5 minutes per warm Lambda invocation.
 */
export async function getTenant(tenantId) {
  const cached = cache.get(tenantId);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.tenant;
  }

  const tenant = await getItem('tenants', { tenant_id: tenantId });
  if (tenant) {
    cache.set(tenantId, { tenant, loadedAt: Date.now() });
  }

  return tenant || null;
}

/**
 * Invalidate cached tenant (after config update).
 */
export function invalidateTenant(tenantId) {
  cache.delete(tenantId);
}
