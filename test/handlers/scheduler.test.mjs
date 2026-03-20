/**
 * Tests for scheduler handler — due events execute, mark completed.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

process.env.FORKLESS_STORAGE = 'local';
process.env.TABLE_PREFIX = 'test-forkless';

const { putItem, getItem } = await import('../../src/lib/dynamo.mjs');

const DATA_DIR = join(process.cwd(), 'data');

describe('scheduler handler', () => {
  before(async () => {
    mkdirSync(DATA_DIR, { recursive: true });
    // Seed tenant
    await putItem('tenants', {
      tenant_id: 'sched-test',
      name: 'Scheduler Test',
    });
    // Seed a due event
    await putItem('scheduler-events', {
      tenant_id: 'sched-test',
      event_id: 'evt-1',
      callback_type: 'create_artifact',
      fire_at: '2020-01-01T00:00:00.000Z', // in the past = due
      status: 'pending',
      title: 'Scheduled Report',
      content_html: '<h1>Report</h1>',
      artifact_type: 'report',
      created_at: '2020-01-01T00:00:00.000Z',
    });
    // Seed a future event (should NOT execute)
    await putItem('scheduler-events', {
      tenant_id: 'sched-test',
      event_id: 'evt-2',
      callback_type: 'send_message',
      fire_at: '2099-01-01T00:00:00.000Z', // in the future
      status: 'pending',
      message: 'Future message',
      created_at: '2024-01-01T00:00:00.000Z',
    });
  });

  after(() => {
    try { rmSync(join(DATA_DIR, 'tenants.json')); } catch {}
    try { rmSync(join(DATA_DIR, 'scheduler-events.json')); } catch {}
    try { rmSync(join(DATA_DIR, 'artifacts.json')); } catch {}
  });

  it('executes due events and marks completed', async () => {
    const { handler } = await import('../../src/handlers/scheduler.mjs');
    const result = await handler({});

    assert.equal(result.executed, 1);
    assert.equal(result.errors, 0);

    // Verify event is marked completed
    const evt = await getItem('scheduler-events', { tenant_id: 'sched-test', event_id: 'evt-1' });
    assert.equal(evt.status, 'completed');
    assert.ok(evt.completed_at);
  });

  it('does not execute future events', async () => {
    const evt = await getItem('scheduler-events', { tenant_id: 'sched-test', event_id: 'evt-2' });
    assert.equal(evt.status, 'pending');
  });
});
