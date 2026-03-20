/**
 * Tests for FAQ cache + crystallization.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

process.env.FORKLESS_STORAGE = 'local';
process.env.TABLE_PREFIX = 'test-forkless';

const { checkCache, recordAnswer } = await import('../../src/lib/faq.mjs');

const DATA_DIR = join(process.cwd(), 'data');

describe('faq', () => {
  before(() => { mkdirSync(DATA_DIR, { recursive: true }); });
  after(() => {
    try { rmSync(join(DATA_DIR, 'faq-cache.json')); } catch {}
  });

  it('cache miss on first query', async () => {
    const result = await checkCache('t1', 'What is Web 4.0?');
    assert.equal(result.hit, false);
  });

  it('records answer and returns hit_count 1', async () => {
    const result = await recordAnswer('t1', 'What is Web 4.0?', 'Web 4.0 is the trust economy era.');
    assert.equal(result.crystallized, false);
    assert.equal(result.hit_count, 1);
  });

  it('still cache miss before crystallization', async () => {
    const result = await checkCache('t1', 'What is Web 4.0?');
    assert.equal(result.hit, false);
  });

  it('crystallizes after 3 consistent answers', async () => {
    // Second consistent answer
    await recordAnswer('t1', 'What is Web 4.0?', 'Web 4.0 is the trust economy era of the internet.');
    // Third consistent answer — should crystallize
    const result = await recordAnswer('t1', 'What is Web 4.0?', 'Web 4.0 is the trust economy era of the web.');
    assert.equal(result.crystallized, true);
  });

  it('cache hit after crystallization', async () => {
    const result = await checkCache('t1', 'What is Web 4.0?');
    assert.equal(result.hit, true);
    assert.ok(result.answer.includes('trust economy'));
  });

  it('different questions are independent', async () => {
    const result = await checkCache('t1', 'What is Forkless?');
    assert.equal(result.hit, false);
  });

  it('tenant isolation', async () => {
    await recordAnswer('t2', 'What is Web 4.0?', 'Something else entirely.');
    const r1 = await checkCache('t1', 'What is Web 4.0?');
    const r2 = await checkCache('t2', 'What is Web 4.0?');
    assert.equal(r1.hit, true); // t1 is crystallized
    assert.equal(r2.hit, false); // t2 is not
  });
});
