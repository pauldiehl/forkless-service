#!/usr/bin/env node
/**
 * Fetch READMEs from Paul's public repos, summarize via Claude, build composite system prompt.
 * Updates the paul-brand tenant record with the generated prompt.
 *
 * Usage: ANTHROPIC_API_KEY=sk-... node scripts/build-tenant-prompt.mjs
 */

import { getItem, updateItem } from '../src/lib/dynamo.mjs';

const TENANT_ID = 'paul-brand';
const GITHUB_USER = 'pauldiehl';
const REPOS = ['forkless', 'diab', 'aip-registry', 'web4', 'trust-economy', 'driftboard', 'crowdsourced-disruption'];

async function fetchReadme(repo) {
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${GITHUB_USER}/${repo}/main/README.md`);
    if (!res.ok) {
      // Try master branch
      const res2 = await fetch(`https://raw.githubusercontent.com/${GITHUB_USER}/${repo}/master/README.md`);
      if (!res2.ok) return null;
      return await res2.text();
    }
    return await res.text();
  } catch {
    return null;
  }
}

async function summarizeReadme(repo, readme) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const anthropic = new Anthropic();

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `Summarize this GitHub README for "${repo}" in ~100 words. Focus on: what it does, why it matters, key technical decisions. No markdown formatting.\n\n${readme.slice(0, 4000)}`,
    }],
  });

  return response.content[0].text;
}

async function main() {
  console.log(`Building system prompt for ${TENANT_ID}...`);

  const tenant = await getItem('tenants', { tenant_id: TENANT_ID });
  if (!tenant) {
    console.error('Tenant not found. Run seed-tenant.mjs first.');
    process.exit(1);
  }

  const summaries = [];

  for (const repo of REPOS) {
    console.log(`  Fetching ${GITHUB_USER}/${repo}...`);
    const readme = await fetchReadme(repo);
    if (!readme) {
      console.log(`    (not found or private)`);
      continue;
    }

    console.log(`  Summarizing (${readme.length} chars)...`);
    const summary = await summarizeReadme(repo, readme);
    summaries.push({ repo, summary });
    console.log(`    Done: ${summary.slice(0, 80)}...`);
  }

  if (summaries.length === 0) {
    console.log('No repos found. Using existing system_prompt.');
    return;
  }

  // Build composite section
  const repoSection = summaries
    .map(s => `### ${s.repo}\n${s.summary}`)
    .join('\n\n');

  const existingPrompt = tenant.system_prompt || '';
  const newPrompt = `${existingPrompt}\n\n## GitHub Projects (auto-generated)\n\n${repoSection}`;

  await updateItem('tenants', { tenant_id: TENANT_ID }, {
    system_prompt: newPrompt,
  });

  console.log(`\nUpdated system_prompt for ${TENANT_ID}`);
  console.log(`  Repos summarized: ${summaries.length}`);
  console.log(`  Total prompt length: ~${newPrompt.length} chars`);
}

main().catch(console.error);
