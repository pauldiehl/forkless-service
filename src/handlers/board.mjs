/**
 * Board API handlers.
 * GET /board          → board columns (optionally filtered by tenant_id)
 * GET /board/{itemId} → single card + comments + decisions
 * POST /board/comment → parse comment, coordinator evaluates
 */

import { createRequire } from 'node:module';
import { authenticateRequest, success, error } from '../lib/auth.mjs';
import { getTenant } from '../lib/tenant.mjs';
import { createDynamoBoard } from '../lib/dynamo-board.mjs';

const require = createRequire(import.meta.url);
let forklessCreateCoordinator;
try {
  const planning = require('forkless/lib/planning/coordinator');
  forklessCreateCoordinator = planning.createCoordinator;
} catch {
  forklessCreateCoordinator = null;
}

export async function handler(event) {
  const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
  const path = event.requestContext?.http?.path || event.path || '/';

  // Extract tenant_id from query string or body
  const qs = event.queryStringParameters || {};

  if (method === 'GET' && (path === '/board' || path.match(/^\/board$/))) {
    return handleGetBoard(event, qs);
  }

  if (method === 'GET' && event.pathParameters?.itemId) {
    return handleGetCard(event, qs);
  }

  if (method === 'POST' && path.endsWith('/board/comment')) {
    return handlePostComment(event);
  }

  return error('Not found', 'NOT_FOUND', 404);
}

async function handleGetBoard(event, qs) {
  const tenantId = qs.tenant_id;
  if (!tenantId) return error('tenant_id query param required', 'MISSING_TENANT');

  const tenant = await getTenant(tenantId);
  if (!tenant) return error('Unknown tenant', 'UNKNOWN_TENANT', 404);

  const board = await createDynamoBoard(tenantId);
  const columns = board.getColumns(qs.project_id);
  const summary = board.getSummary();

  return success({ columns, summary });
}

async function handleGetCard(event, qs) {
  const tenantId = qs.tenant_id;
  const cardId = parseInt(event.pathParameters.itemId, 10);
  if (!tenantId) return error('tenant_id query param required', 'MISSING_TENANT');

  const tenant = await getTenant(tenantId);
  if (!tenant) return error('Unknown tenant', 'UNKNOWN_TENANT', 404);

  const board = await createDynamoBoard(tenantId);
  const card = board.getCard(cardId);
  if (!card) return error('Card not found', 'NOT_FOUND', 404);

  const comments = board.getComments(cardId);
  const decisions = board.getDecisionLog(cardId);

  return success({ card, comments, decisions });
}

async function handlePostComment(event) {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return error('Invalid JSON', 'INVALID_JSON');
  }

  const { tenant_id, card_id, comment, author } = body;
  if (!tenant_id || !card_id || !comment) {
    return error('tenant_id, card_id, and comment are required', 'MISSING_FIELDS');
  }

  const tenant = await getTenant(tenant_id);
  if (!tenant) return error('Unknown tenant', 'UNKNOWN_TENANT', 404);

  const user = authenticateRequest(event);
  const commentAuthor = author || user?.email || 'anonymous';

  const board = await createDynamoBoard(tenant_id);

  // Use coordinator to parse comment intent
  if (forklessCreateCoordinator) {
    const coordinator = forklessCreateCoordinator({
      board,
      objective: tenant.objective || '',
    });

    const result = await coordinator.parseComment(card_id, comment, commentAuthor);
    return success({ intent: result.intent, actionTaken: result.actionTaken });
  }

  // Fallback: just add comment without coordinator
  await board.addComment(card_id, {
    author: commentAuthor,
    body: comment,
    intent: 'general',
  });

  return success({ intent: 'general', actionTaken: null });
}
