/**
 * DynamoDB storage adapter for board.js.
 *
 * Implements the persist/load/onEvent contract that createBoard() expects.
 * - load(tenantId) → queries board-items + board-comments + board-decisions, reconstructs state
 * - persist(tenantId, state) → diffs against previous snapshot, writes only changes
 * - onEvent → pushes to WebSocket (deferred to ws-push integration)
 */

import { queryItems, putItem, deleteItem, batchWrite } from './dynamo.mjs';

/**
 * Create a DynamoDB board adapter for a tenant.
 *
 * @param {string} tenantId
 * @param {Object} [opts]
 * @param {Function} [opts.onEvent] - Event handler for WebSocket push
 * @returns {Object} { load, persist, onEvent } — pass to createBoard()
 */
export function createDynamoBoardAdapter(tenantId, opts = {}) {
  let previousState = null;
  const externalOnEvent = opts.onEvent || (() => {});

  /**
   * Load full board state from DynamoDB.
   * Queries all three tables and reconstructs the state object.
   */
  async function load() {
    const [items, commentRecords, decisionRecords] = await Promise.all([
      queryItems('board-items', { pk: 'tenant_id', pkValue: tenantId }),
      queryItems('board-comments', { pk: 'tenant_id', pkValue: tenantId }),
      queryItems('board-decisions', { pk: 'tenant_id', pkValue: tenantId }),
    ]);

    // Reconstruct cards map
    const cards = {};
    let maxId = 0;
    for (const item of items) {
      const cardId = parseInt(item.item_id, 10);
      cards[cardId] = {
        id: cardId,
        title: item.title,
        description: item.description || '',
        stage: item.stage,
        background: item.background || 'default',
        merit_score: item.merit_score || null,
        assigned_to: item.assigned_to || null,
        artifact_url: item.artifact_url || null,
        parent_id: item.parent_id || null,
        project_id: item.project_id || 'default',
        created_at: item.created_at,
        stage_entered_at: item.stage_entered_at,
      };
      if (cardId > maxId) maxId = cardId;
    }

    // Reconstruct comments map (cardId -> [comment, ...])
    const comments = {};
    for (const rec of commentRecords) {
      const cardId = rec.card_id;
      if (!comments[cardId]) comments[cardId] = [];
      comments[cardId].push({
        id: rec.comment_id,
        cardId: cardId,
        author: rec.author,
        body: rec.body,
        intent: rec.intent || 'general',
        created_at: rec.created_at,
      });
    }

    // Sort comments by created_at
    for (const cardId of Object.keys(comments)) {
      comments[cardId].sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    // Reconstruct decision log
    const decisionLog = decisionRecords
      .map(rec => ({
        type: rec.type,
        timestamp: rec.timestamp,
        cardId: rec.card_id,
        ...(rec.details ? JSON.parse(rec.details) : {}),
      }))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const state = {
      nextId: maxId + 1,
      cards,
      comments,
      decisionLog,
    };

    previousState = JSON.parse(JSON.stringify(state));
    return state;
  }

  /**
   * Persist board state — diff against previous snapshot and write only changes.
   */
  async function persist(state) {
    const prev = previousState || { cards: {}, comments: {}, decisionLog: [] };
    const writes = [];

    // Diff cards — find new/changed/deleted
    const currentCardIds = new Set(Object.keys(state.cards).map(Number));
    const prevCardIds = new Set(Object.keys(prev.cards).map(Number));

    for (const [idStr, card] of Object.entries(state.cards)) {
      const id = parseInt(idStr, 10);
      const prevCard = prev.cards[id];
      if (!prevCard || JSON.stringify(card) !== JSON.stringify(prevCard)) {
        writes.push(putItem('board-items', {
          tenant_id: tenantId,
          item_id: String(id),
          title: card.title,
          description: card.description,
          stage: card.stage,
          background: card.background,
          merit_score: card.merit_score,
          assigned_to: card.assigned_to,
          artifact_url: card.artifact_url,
          parent_id: card.parent_id,
          project_id: card.project_id,
          created_at: card.created_at,
          stage_entered_at: card.stage_entered_at,
        }));
      }
    }

    // Deleted cards
    for (const id of prevCardIds) {
      if (!currentCardIds.has(id)) {
        writes.push(deleteItem('board-items', { tenant_id: tenantId, item_id: String(id) }));
      }
    }

    // Diff comments — find new comments
    for (const [cardId, commentsArr] of Object.entries(state.comments)) {
      const prevComments = prev.comments[cardId] || [];
      for (const comment of commentsArr) {
        const exists = prevComments.some(pc => pc.id === comment.id);
        if (!exists) {
          writes.push(putItem('board-comments', {
            tenant_id: tenantId,
            comment_id: comment.id,
            card_id: parseInt(cardId, 10),
            author: comment.author,
            body: comment.body,
            intent: comment.intent,
            created_at: comment.created_at,
          }));
        }
      }
    }

    // New decision log entries
    const prevDecisionCount = prev.decisionLog.length;
    for (let i = prevDecisionCount; i < state.decisionLog.length; i++) {
      const decision = state.decisionLog[i];
      const { type, timestamp, cardId, ...details } = decision;
      writes.push(putItem('board-decisions', {
        tenant_id: tenantId,
        decision_id: `${timestamp}-${i}`,
        type,
        timestamp,
        card_id: cardId,
        details: JSON.stringify(details),
      }));
    }

    await Promise.all(writes);
    previousState = JSON.parse(JSON.stringify(state));
  }

  function onEvent(event) {
    externalOnEvent({ ...event, tenant_id: tenantId });
  }

  return { load, persist, onEvent };
}

/**
 * Create a board instance with DynamoDB persistence for a tenant.
 * Convenience wrapper that creates the adapter and the board.
 */
export async function createDynamoBoard(tenantId, opts = {}) {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { createBoard } = require('forkless/lib/planning/board');

  const adapter = createDynamoBoardAdapter(tenantId, opts);
  const board = await createBoard({
    persist: adapter.persist,
    load: adapter.load,
    onEvent: adapter.onEvent,
  });

  return board;
}
