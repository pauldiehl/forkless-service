/**
 * Tests for DynamoDB adapter (local mode).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Force local mode
process.env.FORKLESS_STORAGE = 'local';
process.env.TABLE_PREFIX = 'test-forkless';

const { getItem, putItem, deleteItem, queryItems, updateItem, batchWrite, queryByPk } = await import('../../src/lib/dynamo.mjs');

const DATA_DIR = join(process.cwd(), 'data');

describe('dynamo adapter (local)', () => {
  before(() => {
    mkdirSync(DATA_DIR, { recursive: true });
  });

  after(() => {
    // Clean up test data files
    try { rmSync(join(DATA_DIR, 'tenants.json')); } catch {}
    try { rmSync(join(DATA_DIR, 'conversations.json')); } catch {}
    try { rmSync(join(DATA_DIR, 'board-items.json')); } catch {}
  });

  it('putItem and getItem round-trip', async () => {
    const item = { tenant_id: 'test-1', name: 'Test Tenant', created_at: new Date().toISOString() };
    await putItem('tenants', item);
    const result = await getItem('tenants', { tenant_id: 'test-1' });
    assert.equal(result.name, 'Test Tenant');
  });

  it('putItem overwrites existing item', async () => {
    await putItem('tenants', { tenant_id: 'test-1', name: 'Updated' });
    const result = await getItem('tenants', { tenant_id: 'test-1' });
    assert.equal(result.name, 'Updated');
  });

  it('getItem returns null for missing item', async () => {
    const result = await getItem('tenants', { tenant_id: 'nonexistent' });
    assert.equal(result, null);
  });

  it('deleteItem removes item', async () => {
    await putItem('tenants', { tenant_id: 'to-delete', name: 'Delete Me' });
    await deleteItem('tenants', { tenant_id: 'to-delete' });
    const result = await getItem('tenants', { tenant_id: 'to-delete' });
    assert.equal(result, null);
  });

  it('queryItems filters by partition key', async () => {
    await putItem('conversations', { tenant_id: 't1', conversation_id: 'c1', text: 'hello' });
    await putItem('conversations', { tenant_id: 't1', conversation_id: 'c2', text: 'world' });
    await putItem('conversations', { tenant_id: 't2', conversation_id: 'c3', text: 'other' });

    const results = await queryItems('conversations', { pk: 'tenant_id', pkValue: 't1' });
    assert.equal(results.length, 2);
  });

  it('queryItems filters by sort key', async () => {
    const results = await queryItems('conversations', {
      pk: 'tenant_id', pkValue: 't1',
      sk: 'conversation_id', skValue: 'c1',
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].text, 'hello');
  });

  it('updateItem merges fields', async () => {
    await putItem('tenants', { tenant_id: 'update-test', name: 'Before', version: 1 });
    const result = await updateItem('tenants', { tenant_id: 'update-test' }, { name: 'After', version: 2 });
    assert.equal(result.name, 'After');
    assert.equal(result.version, 2);
  });

  it('queryByPk convenience works', async () => {
    const results = await queryByPk('conversations', 'tenant_id', 't1');
    assert.equal(results.length, 2);
  });

  it('batchWrite handles puts', async () => {
    await batchWrite('board-items', [
      { tenant_id: 'b1', item_id: 'i1', title: 'Card 1' },
      { tenant_id: 'b1', item_id: 'i2', title: 'Card 2' },
    ]);
    const r1 = await getItem('board-items', { tenant_id: 'b1', item_id: 'i1' });
    const r2 = await getItem('board-items', { tenant_id: 'b1', item_id: 'i2' });
    assert.equal(r1.title, 'Card 1');
    assert.equal(r2.title, 'Card 2');
  });
});
