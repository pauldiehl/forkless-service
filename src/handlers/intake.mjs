/**
 * Async intake worker — builds tenant knowledge in the background.
 *
 * Invoked asynchronously by the create_tenant tool after the tenant record
 * is saved with status='provisioning'. Crawls the website, summarizes content,
 * generates FAQs, and updates the tenant to status='active'.
 *
 * Event payload: { tenant_id, name, website, knowledge_urls }
 */

import { updateItem, putItem } from '../lib/dynamo.mjs';
import { crawlSite, fetchUrl, summarizeBulk } from '../lib/knowledge.mjs';
import { invalidateTenant } from '../lib/tenant.mjs';
import { createHash } from 'node:crypto';

export async function handler(event) {
  const { tenant_id, name, website, knowledge_urls = [] } = event;

  console.log(`Intake worker started for ${tenant_id}: crawling ${website}`);

  try {
    // 1. Crawl the primary website (auto-discovers internal pages)
    const crawl = await crawlSite(website);
    console.log(`Crawled ${crawl.pages} pages from ${website}`);

    // 2. Fetch any extra knowledge URLs not on the same domain
    let extraContent = '';
    const websiteOrigin = new URL(website).origin;
    const extraUrls = knowledge_urls.filter(u => {
      try { return new URL(u).origin !== websiteOrigin; } catch { return true; }
    });
    if (extraUrls.length > 0) {
      const results = await Promise.allSettled(extraUrls.map(u => fetchUrl(u)));
      const texts = results
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value);
      extraContent = texts.join('\n\n');
      console.log(`Fetched ${texts.length} extra knowledge URLs`);
    }

    // 3. Summarize all content in one Claude call
    const combinedContent = [crawl.content, extraContent].filter(Boolean).join('\n\n');
    let systemPrompt = '';
    if (combinedContent.length > 100) {
      const summary = await summarizeBulk(combinedContent, name);
      systemPrompt = `## Knowledge Base (auto-generated from ${crawl.pages} pages)\n\n${summary}`;
      console.log(`Generated knowledge summary: ${systemPrompt.length} chars`);
    }

    // 4. Generate FAQs from knowledge
    const faqs = [];
    if (systemPrompt) {
      try {
        const Anthropic = (await import('@anthropic-ai/sdk')).default;
        const anthropic = new Anthropic();
        const faqResponse = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          messages: [{
            role: 'user',
            content: `Based on this knowledge about "${name}", generate 8-12 frequently asked questions with answers. Return ONLY a JSON array of objects with "question" and "answer" fields. Keep answers concise (2-3 sentences). No markdown, no explanation, just the JSON array.\n\n${systemPrompt.slice(0, 6000)}`,
          }],
        });
        let faqText = faqResponse.content[0].text;
        // Strip markdown code fences if Claude wraps the JSON
        faqText = faqText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
        const parsed = JSON.parse(faqText);
        if (Array.isArray(parsed)) faqs.push(...parsed);
        console.log(`Generated ${faqs.length} FAQs`);
      } catch (err) {
        console.error('FAQ generation error:', err.message);
      }
    }

    // 5. Update tenant with knowledge + mark active
    await updateItem('tenants', { tenant_id }, {
      system_prompt: systemPrompt,
      status: 'active',
      knowledge_built_at: new Date().toISOString(),
    });
    invalidateTenant(tenant_id);

    // 6. Seed FAQs as crystallized cache entries
    const now = new Date().toISOString();
    for (const faq of faqs) {
      const hash = createHash('sha256')
        .update(faq.question.toLowerCase().trim().replace(/\s+/g, ' '))
        .digest('hex').slice(0, 16);
      await putItem('faq-cache', {
        tenant_id,
        question_hash: hash,
        question: faq.question.toLowerCase().trim(),
        answer: faq.answer,
        hit_count: 1,
        consistent_count: 3,
        crystallized: true,
        created_at: now,
        updated_at: now,
      });
    }

    console.log(`Intake complete for ${tenant_id}: ${crawl.pages} pages, ${faqs.length} FAQs, status=active`);
    return { success: true, pages: crawl.pages, faqs: faqs.length };
  } catch (err) {
    console.error(`Intake worker error for ${tenant_id}:`, err);

    // Mark tenant as active even on failure — it'll work without deep knowledge
    await updateItem('tenants', { tenant_id }, {
      status: 'active',
      knowledge_error: err.message,
    });
    invalidateTenant(tenant_id);

    return { success: false, error: err.message };
  }
}
