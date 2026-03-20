/**
 * GET /chat/status?tenant_id=X&conversation_id=Y
 * Lightweight poll endpoint — checks if an assistant reply has landed.
 * Used by the widget to rescue 504'd requests that are still processing.
 */

import { authenticateRequest, success, error } from '../lib/auth.mjs';
import { loadConversation } from '../lib/conversation-store.mjs';

export async function handler(event) {
  const user = authenticateRequest(event);
  if (!user) return error('Auth required', 'AUTH_REQUIRED', 401);

  const qs = event.queryStringParameters || {};
  const { tenant_id, conversation_id, after } = qs;

  if (!tenant_id || !conversation_id) {
    return error('tenant_id and conversation_id required', 'MISSING_PARAMS');
  }

  const conv = await loadConversation(tenant_id, conversation_id);
  if (!conv) return success({ ready: false });

  // If caller provided 'after' (message count), check if new messages exist
  const afterCount = parseInt(after || '0', 10);
  if (afterCount > 0 && conv.messages.length > afterCount) {
    const last = conv.messages[conv.messages.length - 1];
    if (last.role === 'assistant' || last.role === 'agent') {
      return success({ ready: true, reply: last.content });
    }
  }

  // Fallback: just check if last message is from assistant
  if (conv.messages.length > 0) {
    const last = conv.messages[conv.messages.length - 1];
    if ((last.role === 'assistant' || last.role === 'agent') && !after) {
      return success({ ready: true, reply: last.content });
    }
  }

  return success({ ready: false });
}
