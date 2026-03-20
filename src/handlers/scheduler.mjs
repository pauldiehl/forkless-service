/**
 * Scheduler handler — EventBridge trigger (every 5 minutes).
 * Queries all tenants for due events, executes callbacks, marks completed.
 */

import { scanItems } from '../lib/dynamo.mjs';
import { getDueEvents, markCompleted } from '../lib/dynamo-scheduler.mjs';
import { putItem } from '../lib/dynamo.mjs';
import { randomUUID } from 'node:crypto';

export async function handler(event) {
  console.log('Scheduler tick:', new Date().toISOString());

  // Get all tenants
  const { items: tenants } = await scanItems('tenants', { limit: 100 });

  let executed = 0;
  let errors = 0;

  for (const tenant of tenants) {
    try {
      const dueEvents = await getDueEvents(tenant.tenant_id);

      for (const evt of dueEvents) {
        try {
          await executeCallback(tenant.tenant_id, evt);
          await markCompleted(tenant.tenant_id, evt.event_id);
          executed++;
        } catch (err) {
          console.error(`Event ${evt.event_id} failed:`, err.message);
          errors++;
        }
      }
    } catch (err) {
      console.error(`Tenant ${tenant.tenant_id} scan failed:`, err.message);
      errors++;
    }
  }

  console.log(`Scheduler complete: ${executed} executed, ${errors} errors`);
  return { executed, errors };
}

async function executeCallback(tenantId, evt) {
  switch (evt.callback_type) {
    case 'send_message': {
      // Store a message in the conversation
      const { loadConversation, saveConversation } = await import('../lib/conversation-store.mjs');
      const conv = await loadConversation(tenantId, evt.conversation_id);
      if (conv) {
        conv.messages.push({
          role: 'assistant',
          content: evt.message,
          scheduled: true,
        });
        await saveConversation(conv);
      }
      break;
    }

    case 'create_artifact': {
      await putItem('artifacts', {
        tenant_id: tenantId,
        artifact_id: randomUUID(),
        title: evt.title || 'Scheduled Artifact',
        content_html: evt.content_html || '',
        artifact_type: evt.artifact_type || 'document',
        created_at: new Date().toISOString(),
      });
      break;
    }

    case 'chain_event': {
      // Create a new scheduler event
      const { putEvent } = await import('../lib/dynamo-scheduler.mjs');
      await putEvent(tenantId, {
        event_id: randomUUID(),
        callback_type: evt.chain_callback_type,
        fire_at: evt.chain_fire_at,
        status: 'pending',
        ...evt.chain_payload,
        created_at: new Date().toISOString(),
      });
      break;
    }

    default:
      console.warn(`Unknown callback type: ${evt.callback_type}`);
  }
}
