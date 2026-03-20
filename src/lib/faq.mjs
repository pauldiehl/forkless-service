/**
 * FAQ cache + crystallization.
 *
 * After each response, hash the normalized question and record the answer.
 * After 3+ consistent answers to the same question, promote to cache.
 * Cached answers are returned instantly — zero LLM cost.
 */

import { createHash } from 'node:crypto';
import { getItem, putItem } from './dynamo.mjs';

const CRYSTALLIZE_THRESHOLD = 3;

/**
 * Normalize a question for hashing (lowercase, trim, collapse whitespace).
 */
function normalize(question) {
  return question.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Hash a normalized question.
 */
function hashQuestion(question) {
  return createHash('sha256').update(normalize(question)).digest('hex').slice(0, 16);
}

/**
 * Check cache for a pre-crystallized answer.
 * Returns { hit: true, answer } or { hit: false }.
 */
export async function checkCache(tenantId, question) {
  const questionHash = hashQuestion(question);
  const cached = await getItem('faq-cache', {
    tenant_id: tenantId,
    question_hash: questionHash,
  });

  if (cached && cached.crystallized) {
    return { hit: true, answer: cached.answer, question_hash: questionHash };
  }

  return { hit: false, question_hash: questionHash };
}

/**
 * Record an answer for potential crystallization.
 * Tracks answer consistency. After CRYSTALLIZE_THRESHOLD consistent answers,
 * promotes to cached (crystallized) status.
 */
export async function recordAnswer(tenantId, question, answer) {
  const questionHash = hashQuestion(question);
  const existing = await getItem('faq-cache', {
    tenant_id: tenantId,
    question_hash: questionHash,
  });

  if (existing && existing.crystallized) {
    // Already crystallized — no action needed
    return { crystallized: true, existing: true };
  }

  const now = new Date().toISOString();

  if (!existing) {
    // First time seeing this question
    await putItem('faq-cache', {
      tenant_id: tenantId,
      question_hash: questionHash,
      question: normalize(question),
      answer,
      hit_count: 1,
      consistent_count: 1,
      crystallized: false,
      created_at: now,
      updated_at: now,
    });
    return { crystallized: false, hit_count: 1 };
  }

  // Check consistency — is this answer similar to the last one?
  const isConsistent = answersSimilar(existing.answer, answer);
  const newConsistent = isConsistent ? existing.consistent_count + 1 : 1;
  const shouldCrystallize = newConsistent >= CRYSTALLIZE_THRESHOLD;

  await putItem('faq-cache', {
    ...existing,
    answer,
    hit_count: existing.hit_count + 1,
    consistent_count: newConsistent,
    crystallized: shouldCrystallize,
    updated_at: now,
  });

  return { crystallized: shouldCrystallize, hit_count: existing.hit_count + 1 };
}

/**
 * Simple similarity check — answers are "similar" if they share >=60% of words.
 */
function answersSimilar(a, b) {
  const strip = s => s.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
  const wordsA = new Set(strip(a));
  const wordsB = new Set(strip(b));
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 && (intersection / union) >= 0.6;
}
