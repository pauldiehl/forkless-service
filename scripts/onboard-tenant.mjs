#!/usr/bin/env node
/**
 * Interactive CLI to onboard a new tenant.
 *
 * Usage: node scripts/onboard-tenant.mjs
 *
 * Creates the tenant record in DynamoDB, optionally fetches & summarizes
 * knowledge sources, and prints the embed snippet + SES verification reminders.
 */

import { createInterface } from 'node:readline';
import { putItem } from '../src/lib/dynamo.mjs';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function main() {
  console.log('\n=== Forkless Tenant Onboarding ===\n');

  const tenant_id = (await ask('Tenant ID (slug, e.g. "acme-corp"): ')).trim();
  if (!tenant_id) { console.error('tenant_id is required'); process.exit(1); }

  const name = (await ask('Display name: ')).trim() || tenant_id;
  const description = (await ask('Description (1-2 sentences): ')).trim();
  const tone = (await ask('Tone (e.g. "Friendly, professional"): ')).trim();
  const greeting = (await ask('Agent greeting message: ')).trim();

  const adminRaw = (await ask('Admin emails (comma-separated): ')).trim();
  const admin_users = adminRaw ? adminRaw.split(',').map(e => e.trim()).filter(Boolean) : [];

  console.log('\nKnowledge sources — enter URLs one per line. Empty line to finish:');
  const knowledge_sources = [];
  while (true) {
    const url = (await ask('  URL: ')).trim();
    if (!url) break;
    const sourceName = (await ask('  Name (optional): ')).trim();
    knowledge_sources.push({ url, name: sourceName || undefined });
  }

  const originsRaw = (await ask('Allowed CORS origins (comma-separated, e.g. "https://example.com"): ')).trim();
  const allowed_origins = originsRaw ? originsRaw.split(',').map(o => o.trim()).filter(Boolean) : [];

  const ses_from_email = (await ask('Custom SES sender email (optional, must be verified in SES): ')).trim() || undefined;
  const accent_color = (await ask('Accent color (default #e8735a): ')).trim() || '#e8735a';
  const theme = (await ask('Theme (dark/light, default dark): ')).trim() || 'dark';

  const tenant = {
    tenant_id,
    name,
    description,
    tone,
    greeting,
    admin_users,
    knowledge_sources,
    allowed_origins,
    ses_from_email,
    accent_color,
    theme,
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system_prompt: '',
    created_at: new Date().toISOString(),
  };

  // Optionally fetch & summarize knowledge sources
  if (knowledge_sources.length > 0 && process.env.ANTHROPIC_API_KEY) {
    console.log('\nFetching and summarizing knowledge sources...');
    try {
      const { buildKnowledgePrompt } = await import('../src/lib/knowledge.mjs');
      const knowledgeSection = await buildKnowledgePrompt(knowledge_sources);
      if (knowledgeSection) {
        tenant.system_prompt = `## Knowledge Sources (auto-generated)\n\n${knowledgeSection}`;
        console.log(`  Summarized ${knowledge_sources.length} source(s).`);
      }
    } catch (err) {
      console.error(`  Failed to summarize: ${err.message}`);
      console.log('  You can run POST /admin/refresh-knowledge later.');
    }
  } else if (knowledge_sources.length > 0) {
    console.log('\nNo ANTHROPIC_API_KEY set — skipping knowledge summarization.');
    console.log('Run POST /admin/refresh-knowledge after deploy to build the knowledge prompt.');
  }

  // Write to DynamoDB
  await putItem('tenants', tenant);
  console.log(`\nTenant "${name}" (${tenant_id}) created successfully.`);

  // Print embed snippet
  const apiBase = process.env.API_BASE || 'https://api.agentintake.io';
  console.log('\n--- Embed Snippet ---');
  console.log(`<script src="${apiBase}/widget.js" data-api="${apiBase}" data-tenant="${tenant_id}"></script>`);

  // SES reminder
  if (ses_from_email) {
    console.log('\n--- SES Verification Required ---');
    console.log(`Custom sender: ${ses_from_email}`);
    console.log('Verify this email/domain in AWS SES before sending OTPs:');
    console.log(`  aws ses verify-email-identity --email-address ${ses_from_email}`);
  }

  console.log('\nDone.\n');
  rl.close();
}

main().catch(err => { console.error(err); process.exit(1); });
