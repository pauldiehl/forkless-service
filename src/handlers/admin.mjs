/**
 * Admin API handlers.
 * GET /admin/{tenantId}               → tenant stats
 * GET /admin/{tenantId}/conversations → conversation list
 * POST /admin/config                  → update tenant settings
 * POST /admin/refresh-knowledge       → rebuild system_prompt from knowledge sources
 */

import { requireAuth, success, error } from '../lib/auth.mjs';
import { getTenant, invalidateTenant } from '../lib/tenant.mjs';
import { updateItem, queryItems } from '../lib/dynamo.mjs';

export async function handler(event) {
  const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
  const path = event.requestContext?.http?.path || event.path || '/';

  // Require authentication for all admin endpoints
  const user = requireAuth(event);
  if (!user) return error('Authentication required', 'UNAUTHORIZED', 401);
  if (user.trustLevel !== 'admin' && user.trustLevel !== 'founder') {
    return error('Admin access required', 'FORBIDDEN', 403);
  }

  // POST routes (exact path match)
  if (method === 'POST' && path.endsWith('/admin/config')) {
    return handleUpdateConfig(event, user);
  }
  if (method === 'POST' && path.endsWith('/admin/refresh-knowledge')) {
    return handleRefreshKnowledge(event, user);
  }

  // GET routes with tenantId prefix parameter
  if (method === 'GET' && event.pathParameters?.tenantId) {
    const raw = event.pathParameters.tenantId;
    const parts = raw.split('/');
    const tenantId = parts[0];
    const subPath = parts[1] || '';

    if (subPath === 'conversations') {
      return handleGetConversations(event, user, tenantId);
    }
    // Default: stats
    return handleGetStats(event, user, tenantId);
  }

  return error('Not found', 'NOT_FOUND', 404);
}

async function handleGetStats(event, user, tenantId) {
  if (user.tenant_id !== tenantId) {
    return error('Access denied to this tenant', 'FORBIDDEN', 403);
  }

  const tenant = await getTenant(tenantId);
  if (!tenant) return error('Unknown tenant', 'UNKNOWN_TENANT', 404);

  const [conversations, journeys, faqEntries] = await Promise.all([
    queryItems('conversations', { pk: 'tenant_id', pkValue: tenantId }),
    queryItems('journey-states', { pk: 'tenant_id', pkValue: tenantId }),
    queryItems('faq-cache', { pk: 'tenant_id', pkValue: tenantId }),
  ]);

  const crystallized = faqEntries.filter(f => f.crystallized).length;

  return success({
    tenant_id: tenantId,
    name: tenant.name,
    stats: {
      conversations: conversations.length,
      active_journeys: journeys.filter(j => j.status === 'active').length,
      total_journeys: journeys.length,
      faq_entries: faqEntries.length,
      faq_crystallized: crystallized,
    },
  });
}

async function handleGetConversations(event, user, tenantId) {
  if (user.tenant_id !== tenantId) {
    return error('Access denied to this tenant', 'FORBIDDEN', 403);
  }

  const tenant = await getTenant(tenantId);
  if (!tenant) return error('Unknown tenant', 'UNKNOWN_TENANT', 404);

  const conversations = await queryItems('conversations', { pk: 'tenant_id', pkValue: tenantId });

  return success({
    conversations: conversations.map(c => ({
      conversation_id: c.conversation_id,
      email: c.email,
      message_count: c.messages?.length || 0,
      last_activity: c.updated_at || c.created_at,
      preview: c.messages?.slice(-1)[0]?.content?.slice(0, 100) || '',
    })),
  });
}

async function handleUpdateConfig(event, user) {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return error('Invalid JSON', 'INVALID_JSON');
  }

  const { tenant_id, updates } = body;
  if (!tenant_id || !updates) {
    return error('tenant_id and updates are required', 'MISSING_FIELDS');
  }

  if (user.tenant_id !== tenant_id) {
    return error('Access denied to this tenant', 'FORBIDDEN', 403);
  }

  const allowed = ['name', 'description', 'system_prompt', 'tone', 'greeting',
    'theme', 'accent_color', 'model', 'max_tokens', 'objective',
    'allowed_origins', 'knowledge_sources', 'ses_from_email', 'admin_users', 'board_enabled'];
  const filtered = {};
  for (const key of allowed) {
    if (key in updates) filtered[key] = updates[key];
  }

  if (Object.keys(filtered).length === 0) {
    return error('No valid fields to update', 'NO_VALID_FIELDS');
  }

  const result = await updateItem('tenants', { tenant_id }, filtered);
  invalidateTenant(tenant_id);

  return success({ updated: true, tenant: result });
}

async function handleRefreshKnowledge(event, user) {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return error('Invalid JSON', 'INVALID_JSON');
  }

  const { tenant_id } = body;
  if (!tenant_id) {
    return error('tenant_id is required', 'MISSING_FIELDS');
  }

  if (user.tenant_id !== tenant_id) {
    return error('Access denied to this tenant', 'FORBIDDEN', 403);
  }

  const tenant = await getTenant(tenant_id);
  if (!tenant) return error('Unknown tenant', 'UNKNOWN_TENANT', 404);

  const sources = tenant.knowledge_sources || [];
  if (sources.length === 0) {
    return error('No knowledge sources configured', 'NO_SOURCES');
  }

  const { buildKnowledgePrompt } = await import('../lib/knowledge.mjs');
  const knowledgeSection = await buildKnowledgePrompt(sources);

  // Replace auto-generated section, preserve manually-written content
  const marker = '## Knowledge Sources (auto-generated)';
  const basePrompt = (tenant.system_prompt || '').split(marker)[0].trim();
  const newPrompt = `${basePrompt}\n\n${marker}\n\n${knowledgeSection}`;

  await updateItem('tenants', { tenant_id }, { system_prompt: newPrompt });
  invalidateTenant(tenant_id);

  return success({ refreshed: true, sources: sources.length });
}
