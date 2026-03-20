/**
 * Integration test: Chat tool creates a board card.
 * Tests the tools.mjs executeTool → dynamo-board pipeline.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

process.env.FORKLESS_STORAGE = 'local';
process.env.TABLE_PREFIX = 'test-forkless';

const { executeTool } = await import('../../src/lib/tools.mjs');
const { putItem, getItem, queryItems } = await import('../../src/lib/dynamo.mjs');

const DATA_DIR = join(process.cwd(), 'data');

// Try to load forkless board
let createBoard;
try {
  const require = createRequire(import.meta.url);
  createBoard = require('forkless/lib/planning/board').createBoard;
} catch {
  createBoard = null;
}

describe('chat-to-board integration', () => {
  before(async () => {
    mkdirSync(DATA_DIR, { recursive: true });
    await putItem('tenants', { tenant_id: 'int-test', name: 'Integration Test' });
  });

  after(() => {
    try { rmSync(join(DATA_DIR, 'tenants.json')); } catch {}
    try { rmSync(join(DATA_DIR, 'board-items.json')); } catch {}
    try { rmSync(join(DATA_DIR, 'board-comments.json')); } catch {}
    try { rmSync(join(DATA_DIR, 'board-decisions.json')); } catch {}
    try { rmSync(join(DATA_DIR, 'artifacts.json')); } catch {}
  });

  if (!createBoard) {
    it('skipped — forkless lib not available', () => {
      assert.ok(true, 'Forkless not linked, skipping board integration');
    });
    return;
  }

  it('create_board_card tool creates a card via board instance', async () => {
    const board = await createBoard();

    const result = await executeTool('create_board_card', {
      title: 'Build user dashboard',
      description: 'Create a dashboard showing user activity',
      stage: 'intake',
      background: 'active',
    }, { board, tenantId: 'int-test' });

    assert.equal(result.action, 'card_created');
    assert.ok(result.card);
    assert.equal(result.card.title, 'Build user dashboard');
    assert.equal(result.card.stage, 'intake');
    assert.equal(result.card.background, 'active');
  });

  it('show_board tool returns columns from board', async () => {
    const board = await createBoard();
    await board.addCard({ title: 'Test card for show_board' });

    const result = await executeTool('show_board', {
      mode: 'full_board',
    }, { board, tenantId: 'int-test' });

    assert.equal(result.action, 'show_board');
    assert.ok(result.columns);
    assert.ok(result.columns.intake);
  });

  it('generate_artifact tool creates artifact in DynamoDB', async () => {
    const result = await executeTool('generate_artifact', {
      title: 'Test Report',
      content_html: '<h1>Test Report</h1><p>Content here</p>',
      artifact_type: 'report',
    }, { tenantId: 'int-test' });

    assert.equal(result.action, 'artifact_created');
    assert.ok(result.artifact_id);
    assert.ok(result.url.includes(result.artifact_id));

    // Verify it's in DynamoDB
    const artifact = await getItem('artifacts', {
      tenant_id: 'int-test',
      artifact_id: result.artifact_id,
    });
    assert.equal(artifact.title, 'Test Report');
  });

  it('focus_card tool returns card details', async () => {
    const board = await createBoard();
    const card = await board.addCard({ title: 'Focusable card' });

    const result = await executeTool('focus_card', {
      card_id: card.id,
    }, { board, tenantId: 'int-test' });

    assert.equal(result.action, 'focus_card');
    assert.equal(result.card.title, 'Focusable card');
  });
});
