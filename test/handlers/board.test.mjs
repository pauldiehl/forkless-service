/**
 * Tests for board handler — GET board columns, POST comment.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

process.env.FORKLESS_STORAGE = 'local';
process.env.TABLE_PREFIX = 'test-forkless';

const { putItem } = await import('../../src/lib/dynamo.mjs');

const DATA_DIR = join(process.cwd(), 'data');

describe('board handler', () => {
  before(async () => {
    mkdirSync(DATA_DIR, { recursive: true });
    // Seed tenant
    await putItem('tenants', {
      tenant_id: 'board-test',
      name: 'Board Test',
      objective: 'Test the board',
    });
    // Seed a board card
    await putItem('board-items', {
      tenant_id: 'board-test',
      item_id: '1',
      title: 'Test Card',
      description: 'A seeded card',
      stage: 'intake',
      background: 'default',
      created_at: '2024-01-01T00:00:00.000Z',
      stage_entered_at: '2024-01-01T00:00:00.000Z',
    });
  });

  after(() => {
    try { rmSync(join(DATA_DIR, 'tenants.json')); } catch {}
    try { rmSync(join(DATA_DIR, 'board-items.json')); } catch {}
    try { rmSync(join(DATA_DIR, 'board-comments.json')); } catch {}
    try { rmSync(join(DATA_DIR, 'board-decisions.json')); } catch {}
  });

  it('GET /board returns columns with seeded card', async () => {
    const { handler } = await import('../../src/handlers/board.mjs');
    const res = await handler({
      requestContext: { http: { method: 'GET', path: '/board' } },
      queryStringParameters: { tenant_id: 'board-test' },
      cookies: [],
      headers: {},
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.data.columns);
    assert.ok(body.data.columns.intake);
    assert.equal(body.data.columns.intake.length, 1);
    assert.equal(body.data.columns.intake[0].title, 'Test Card');
  });

  it('GET /board rejects missing tenant', async () => {
    const { handler } = await import('../../src/handlers/board.mjs');
    const res = await handler({
      requestContext: { http: { method: 'GET', path: '/board' } },
      queryStringParameters: {},
      cookies: [],
      headers: {},
    });
    assert.equal(res.statusCode, 400);
  });

  it('POST /board/comment adds a comment', async () => {
    const { handler } = await import('../../src/handlers/board.mjs');
    const res = await handler({
      requestContext: { http: { method: 'POST', path: '/board/comment' } },
      body: JSON.stringify({
        tenant_id: 'board-test',
        card_id: 1,
        comment: 'Looks good, approved!',
        author: 'tester',
      }),
      cookies: [],
      headers: {},
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.data.intent);
  });
});
