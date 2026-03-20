/**
 * Conversation persistence — CRUD against the conversations table.
 * Each conversation stores its full message history.
 */

import { randomUUID } from 'node:crypto';
import { getItem, putItem, queryItems } from './dynamo.mjs';

/**
 * Create a new conversation.
 */
export async function createConversation(tenantId, email, providedId) {
  const conversation = {
    tenant_id: tenantId,
    conversation_id: providedId || randomUUID(),
    email: email || null,
    messages: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await putItem('conversations', conversation);
  return conversation;
}

/**
 * Load a conversation by ID.
 */
export async function loadConversation(tenantId, conversationId) {
  return getItem('conversations', {
    tenant_id: tenantId,
    conversation_id: conversationId,
  });
}

/**
 * Save conversation (full overwrite — messages array is the source of truth).
 */
export async function saveConversation(conversation) {
  conversation.updated_at = new Date().toISOString();
  await putItem('conversations', conversation);
  return conversation;
}

/**
 * List conversations for a tenant (most recent first).
 */
export async function listConversations(tenantId, limit = 20) {
  return queryItems('conversations', {
    pk: 'tenant_id',
    pkValue: tenantId,
    scanForward: false,
    limit,
  });
}
