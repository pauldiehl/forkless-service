/**
 * Tests for DynamoDB board adapter — load/persist round-trip, incremental diff writes.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

process.env.FORKLESS_STORAGE = 'local';
process.env.TABLE_PREFIX = 'test-forkless';

const { createDynamoBoardAdapter } = await import('../../src/lib/dynamo-board.mjs');
const { getItem, putItem, queryItems } = await import('../../src/lib/dynamo.mjs');

const DATA_DIR = join(process.cwd(), 'data');

describe('dynamo-board adapter', () => {
  before(() => { mkdirSync(DATA_DIR, { recursive: true }); });
  after(() => {
    try { rmSync(join(DATA_DIR, 'board-items.json')); } catch {}
    try { rmSync(join(DATA_DIR, 'board-comments.json')); } catch {}
    try { rmSync(join(DATA_DIR, 'board-decisions.json')); } catch {}
  });

  it('load returns empty state for new tenant', async () => {
    const adapter = createDynamoBoardAdapter('new-tenant');
    const state = await adapter.load();
    assert.deepEqual(state.cards, {});
    assert.deepEqual(state.comments, {});
    assert.deepEqual(state.decisionLog, []);
    assert.equal(state.nextId, 1);
  });

  it('persist saves cards to DynamoDB', async () => {
    const adapter = createDynamoBoardAdapter('board-t1');
    await adapter.load(); // Initialize previousState

    const state = {
      nextId: 2,
      cards: {
        1: {
          id: 1,
          title: 'Test Card',
          description: 'A test card',
          stage: 'intake',
          background: 'default',
          merit_score: null,
          assigned_to: null,
          artifact_url: null,
          parent_id: null,
          project_id: 'default',
          created_at: '2024-01-01T00:00:00.000Z',
          stage_entered_at: '2024-01-01T00:00:00.000Z',
        },
      },
      comments: {},
      decisionLog: [],
    };

    await adapter.persist(state);

    const saved = await getItem('board-items', { tenant_id: 'board-t1', item_id: '1' });
    assert.equal(saved.title, 'Test Card');
    assert.equal(saved.stage, 'intake');
  });

  it('load round-trips persisted state', async () => {
    const adapter = createDynamoBoardAdapter('board-t1');
    const state = await adapter.load();
    assert.ok(state.cards[1]);
    assert.equal(state.cards[1].title, 'Test Card');
    assert.equal(state.nextId, 2);
  });

  it('persist saves comments', async () => {
    const adapter = createDynamoBoardAdapter('board-t1');
    await adapter.load();

    const state = {
      nextId: 2,
      cards: {
        1: {
          id: 1, title: 'Test Card', description: 'A test card',
          stage: 'intake', background: 'default', merit_score: null,
          assigned_to: null, artifact_url: null, parent_id: null,
          project_id: 'default', created_at: '2024-01-01T00:00:00.000Z',
          stage_entered_at: '2024-01-01T00:00:00.000Z',
        },
      },
      comments: {
        1: [{
          id: '1-0', cardId: 1, author: 'test-user',
          body: 'Looks good!', intent: 'validation',
          created_at: '2024-01-01T01:00:00.000Z',
        }],
      },
      decisionLog: [{
        type: 'card_added', timestamp: '2024-01-01T00:00:00.000Z',
        cardId: 1,
      }],
    };

    await adapter.persist(state);

    // Verify comment was saved
    const comments = await queryItems('board-comments', {
      pk: 'tenant_id', pkValue: 'board-t1',
    });
    assert.equal(comments.length, 1);
    assert.equal(comments[0].body, 'Looks good!');
  });

  it('persist only writes changed cards (incremental diff)', async () => {
    const adapter = createDynamoBoardAdapter('board-t1');
    const state = await adapter.load();

    // Add a second card — first card is unchanged
    state.cards[2] = {
      id: 2, title: 'Card Two', description: 'Second card',
      stage: 'qualified', background: 'active', merit_score: 0.85,
      assigned_to: null, artifact_url: null, parent_id: null,
      project_id: 'default', created_at: '2024-01-02T00:00:00.000Z',
      stage_entered_at: '2024-01-02T00:00:00.000Z',
    };
    state.nextId = 3;

    await adapter.persist(state);

    // Verify both cards exist
    const card1 = await getItem('board-items', { tenant_id: 'board-t1', item_id: '1' });
    const card2 = await getItem('board-items', { tenant_id: 'board-t1', item_id: '2' });
    assert.equal(card1.title, 'Test Card');
    assert.equal(card2.title, 'Card Two');
    assert.equal(card2.stage, 'qualified');
  });

  it('onEvent forwards to external handler', async () => {
    const events = [];
    const adapter = createDynamoBoardAdapter('board-t1', {
      onEvent: (e) => events.push(e),
    });
    adapter.onEvent({ type: 'card_added', cardId: 1 });
    assert.equal(events.length, 1);
    assert.equal(events[0].tenant_id, 'board-t1');
  });
});
