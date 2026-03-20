/**
 * Knowledge source fetching, crawling, and summarization.
 * Generalized from scripts/build-tenant-prompt.mjs for use by the admin refresh-knowledge endpoint.
 */

const FETCH_TIMEOUT_MS = 5000;
const MAX_CRAWL_PAGES = 50;

/**
 * Fetch content from a URL with timeout. Handles GitHub raw URLs and standard web pages.
 * @param {string} url - URL to fetch
 * @returns {string|null} Content or null on failure
 */
export async function fetchUrl(url) {
  try {
    // Convert GitHub repo URLs to raw README URLs
    const ghMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/);
    if (ghMatch) {
      const [, owner, repo] = ghMatch;
      const mainRes = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (mainRes.ok) return await mainRes.text();
      const masterRes = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/master/README.md`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (masterRes.ok) return await masterRes.text();
      return null;
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Strip HTML to plain text. Removes scripts, styles, tags, and collapses whitespace.
 * @param {string} html - Raw HTML
 * @returns {string} Plain text
 */
function htmlToText(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract internal links from HTML content.
 * @param {string} html - HTML content
 * @param {string} baseUrl - Base URL for resolving relative links
 * @returns {string[]} Array of absolute internal URLs
 */
function extractInternalLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const links = new Set();
  const hrefRegex = /href=["']([^"']+)["']/gi;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    try {
      const resolved = new URL(match[1], baseUrl);
      // Same origin, not an anchor, not a file download
      if (resolved.origin === base.origin
        && !resolved.hash
        && !resolved.pathname.match(/\.(pdf|zip|png|jpg|jpeg|gif|svg|css|js|ico|woff|ttf)$/i)) {
        resolved.hash = '';
        resolved.search = '';
        links.add(resolved.href);
      }
    } catch { /* skip invalid URLs */ }
  }
  return [...links];
}

/**
 * Crawl a website: fetch homepage, discover internal links, parallel-fetch all pages.
 * Returns combined text content from all pages.
 * @param {string} baseUrl - Root URL to crawl
 * @param {number} [maxPages=50] - Max pages to fetch
 * @returns {Promise<{pages: number, content: string}>} Combined text and page count
 */
export async function crawlSite(baseUrl, maxPages = MAX_CRAWL_PAGES) {
  // Fetch homepage
  const homepageHtml = await fetchUrl(baseUrl);
  if (!homepageHtml) return { pages: 0, content: '' };

  // Discover internal links
  const discoveredUrls = extractInternalLinks(homepageHtml, baseUrl);
  const allUrls = [baseUrl, ...discoveredUrls].slice(0, maxPages);

  // Parallel-fetch all pages
  const results = await Promise.allSettled(
    allUrls.map(async (url) => {
      const html = url === baseUrl ? homepageHtml : await fetchUrl(url);
      if (!html) return null;
      const text = htmlToText(html);
      // Skip pages with very little content
      if (text.length < 50) return null;
      return { url, text };
    })
  );

  const pages = results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);

  const combined = pages
    .map(p => `--- ${p.url} ---\n${p.text}`)
    .join('\n\n');

  return { pages: pages.length, content: combined };
}

/**
 * Summarize content via Claude.
 * @param {string} content - Raw content to summarize
 * @param {string} sourceName - Name for context (e.g. repo name, doc title)
 * @returns {string} Summary text
 */
export async function summarizeContent(content, sourceName) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const anthropic = new Anthropic();

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `Summarize this document for "${sourceName}" in ~100 words. Focus on: what it does, why it matters, key technical decisions. No markdown formatting.\n\n${content.slice(0, 4000)}`,
    }],
  });

  return response.content[0].text;
}

/**
 * Summarize bulk content (from crawl or multiple sources) in a single Claude call.
 * @param {string} combinedContent - All page text concatenated
 * @param {string} name - Business/project name for context
 * @returns {string} Knowledge summary suitable for system prompt
 */
export async function summarizeBulk(combinedContent, name) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const anthropic = new Anthropic();

  // Truncate to fit context — keep first 80k chars (roughly 20k tokens)
  const truncated = combinedContent.slice(0, 80000);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `You are reading the website content for "${name}". Produce a comprehensive knowledge base summary that an AI agent can use to answer questions about this business. Include:

- What the business/product does
- Key features, services, or offerings
- Important details (pricing, specs, comparisons) if present
- Target audience
- Any unique selling points

Write in plain text, organized by topic. Be thorough — this is the agent's entire knowledge. ~500-800 words.

${truncated}`,
    }],
  });

  return response.content[0].text;
}

/**
 * Fetch all knowledge sources, summarize each, compose into a prompt section.
 * @param {Array<{url: string, type?: string, name?: string}>} sources
 * @returns {string} Composed knowledge section
 */
export async function buildKnowledgePrompt(sources) {
  const summaries = [];

  for (const source of sources) {
    const name = source.name || source.url.split('/').filter(Boolean).pop() || 'Document';
    const content = await fetchUrl(source.url);
    if (!content) continue;

    const summary = await summarizeContent(content, name);
    summaries.push({ name, summary });
  }

  if (summaries.length === 0) return '';

  return summaries
    .map(s => `### ${s.name}\n${s.summary}`)
    .join('\n\n');
}
