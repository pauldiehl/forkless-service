/**
 * Tests for tenant loader + cache.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

process.env.FORKLESS_STORAGE = 'local';
process.env.TABLE_PREFIX = 'test-forkless';

const { putItem } = await import('../../src/lib/dynamo.mjs');
const { getTenant, invalidateTenant } = await import('../../src/lib/tenant.mjs');

const DATA_DIR = join(process.cwd(), 'data');

describe('tenant', () => {
  before(async () => {
    mkdirSync(DATA_DIR, { recursive: true });
    await putItem('tenants', {
      tenant_id: 'paul-brand',
      name: 'Paul Diehl',
      description: 'Web 4.0 builder',
      admin_users: ['paul@example.com'],
      system_prompt: 'You are a helpful assistant.',
    });
  });

  after(() => {
    try { rmSync(join(DATA_DIR, 'tenants.json')); } catch {}
  });

  it('loads tenant by ID', async () => {
    const tenant = await getTenant('paul-brand');
    assert.equal(tenant.name, 'Paul Diehl');
    assert.deepEqual(tenant.admin_users, ['paul@example.com']);
  });

  it('returns null for missing tenant', async () => {
    const tenant = await getTenant('nonexistent');
    assert.equal(tenant, null);
  });

  it('caches tenant on second call', async () => {
    const t1 = await getTenant('paul-brand');
    const t2 = await getTenant('paul-brand');
    assert.equal(t1, t2); // Same object reference from cache
  });

  it('invalidateTenant clears cache', async () => {
    // Re-seed in case other tests cleaned up the data dir
    await putItem('tenants', {
      tenant_id: 'paul-brand',
      name: 'Paul Diehl',
      description: 'Web 4.0 builder',
      admin_users: ['paul@example.com'],
      system_prompt: 'You are a helpful assistant.',
    });
    await getTenant('paul-brand');
    invalidateTenant('paul-brand');
    const tenant = await getTenant('paul-brand');
    assert.equal(tenant.name, 'Paul Diehl');
  });
});
