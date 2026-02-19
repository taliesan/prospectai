// Blog Crawler — Detect and crawl subject's own publishing platforms
// Collects Tier 1 sources: blog posts, LinkedIn posts, personal writing

import { complete } from '../anthropic';
import { ResearchSource } from './screening';

// ── Blog detection ──────────────────────────────────────────────────

interface BlogDetection {
  isBlog: boolean;
  platform: 'wordpress' | 'substack' | 'medium' | 'ghost' | 'custom' | null;
  postUrls: string[];
}

const BLOG_URL_PATTERNS: Record<string, RegExp> = {
  substack: /\.substack\.com/i,
  medium: /medium\.com\/@|medium\.com\/[^/]+\/[a-z0-9-]+/i,
  wordpress: /\.wordpress\.com/i,
  ghost: /\.ghost\.io/i,
};

const BLOG_CONTENT_PATTERNS: Record<string, RegExp> = {
  wordpress: /wp-content|wp-json|class="wp-/i,
  ghost: /class="gh-|\/ghost\/api/i,
};

export function detectBlog(url: string, content: string): BlogDetection {
  // Check URL patterns first
  for (const [platform, pattern] of Object.entries(BLOG_URL_PATTERNS)) {
    if (pattern.test(url)) {
      return { isBlog: true, platform: platform as BlogDetection['platform'], postUrls: [] };
    }
  }

  // Check content patterns
  for (const [platform, pattern] of Object.entries(BLOG_CONTENT_PATTERNS)) {
    if (pattern.test(content)) {
      return { isBlog: true, platform: platform as BlogDetection['platform'], postUrls: [] };
    }
  }

  // Check for blog-like structure in content
  const hasPostListings = /<article|class="post"|class="entry"|class="blog-post"|<h2.*?<a\s+href/i.test(content);
  const hasArchive = /archive|all posts|older posts|page\/2|\/blog\b/i.test(content);

  if (hasPostListings || hasArchive) {
    return { isBlog: true, platform: 'custom', postUrls: [] };
  }

  return { isBlog: false, platform: null, postUrls: [] };
}

// ── Coded regex URL extraction per platform ─────────────────────────

/**
 * Extract post URLs using coded regex patterns. No LLM needed.
 * Processes the FULL content (not truncated), which is critical for
 * large archive pages (e.g. Substack 220K chars).
 */
function extractUrlsWithRegex(
  baseUrl: string,
  content: string,
  platform: string | null
): { url: string; title: string }[] {
  const posts: { url: string; title: string }[] = [];
  const seenUrls = new Set<string>();

  let baseHost: string;
  try {
    baseHost = new URL(baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`).origin;
  } catch {
    baseHost = baseUrl;
  }

  const addPost = (url: string, title: string) => {
    // Resolve relative URLs
    let absoluteUrl = url;
    if (url.startsWith('/')) {
      absoluteUrl = baseHost + url;
    } else if (!url.startsWith('http')) {
      absoluteUrl = baseHost + '/' + url;
    }
    // Deduplicate
    if (!seenUrls.has(absoluteUrl)) {
      seenUrls.add(absoluteUrl);
      posts.push({ url: absoluteUrl, title: title || absoluteUrl });
    }
  };

  if (platform === 'substack') {
    // Substack post URLs: /p/slug-name (with optional query params)
    const substackPattern = /(?:href=["']|)(\/p\/[a-z0-9][-a-z0-9]*[a-z0-9])(?:[?#"'\s]|$)/gi;
    let match;
    while ((match = substackPattern.exec(content)) !== null) {
      const slug = match[1];
      // Try to find a title near this URL in the content
      const titleMatch = content.slice(Math.max(0, match.index - 200), match.index + 200)
        .match(/(?:title=["']([^"']+)|>([^<]{5,80})<\/(?:a|h[1-6]))/i);
      const title = titleMatch ? (titleMatch[1] || titleMatch[2] || '').trim() : '';
      addPost(slug, title);
    }
    console.log(`[Blog Crawl] Substack regex: found ${posts.length} /p/ URLs in ${content.length} chars`);
  }

  if (platform === 'wordpress' || !platform) {
    // WordPress: /YYYY/MM/DD/slug or /YYYY/MM/slug
    const wpPattern = /(?:href=["']|)(\/\d{4}\/\d{2}(?:\/\d{2})?\/[a-z0-9][-a-z0-9]*[a-z0-9]\/?)(?:[?#"'\s]|$)/gi;
    let match;
    while ((match = wpPattern.exec(content)) !== null) {
      addPost(match[1], '');
    }
  }

  if (platform === 'medium') {
    // Medium: /@author/slug-hexid or /slug-hexid
    const mediumPattern = /(?:href=["']|)(\/(?:@[a-z0-9_-]+\/)?[a-z0-9][-a-z0-9]*-[a-f0-9]{8,12})(?:[?#"'\s]|$)/gi;
    let match;
    while ((match = mediumPattern.exec(content)) !== null) {
      addPost(match[1], '');
    }
  }

  if (platform === 'ghost') {
    // Ghost: /slug-name/ (simple paths, not /tag/, /author/, /page/)
    const ghostPattern = /(?:href=["']|)(\/(?!tag\/|author\/|page\/)[a-z0-9][-a-z0-9]*[a-z0-9]\/?)(?:[?#"'\s]|$)/gi;
    let match;
    while ((match = ghostPattern.exec(content)) !== null) {
      addPost(match[1], '');
    }
  }

  // Generic fallback: HTML anchor tags with article-like paths
  if (posts.length === 0) {
    const genericPattern = /href=["']((?:https?:\/\/[^"']*|\/[^"']*?)(?:\/(?:blog|post|article|news|story|writing)s?\/[^"']+|\/\d{4}\/[^"']+))["']/gi;
    let match;
    while ((match = genericPattern.exec(content)) !== null) {
      addPost(match[1], '');
    }
  }

  return posts;
}

// ── Post URL extraction ─────────────────────────────────────────────

export async function extractPostUrls(
  blogUrl: string,
  blogContent: string,
  platform: string | null,
  fetchFunction: (url: string) => Promise<string>
): Promise<{ url: string; title: string }[]> {
  let contentToSearch = blogContent;

  // For Substack, fetch the archive page (has all posts)
  if (platform === 'substack') {
    try {
      const archiveUrl = blogUrl.replace(/\/$/, '') + '/archive';
      contentToSearch = await fetchFunction(archiveUrl);
      console.log(`[Blog Crawl] Fetched Substack archive: ${contentToSearch.length} chars`);
    } catch {
      console.log('[Blog Crawl] Failed to fetch Substack archive, using homepage content');
    }
  }

  // Step 1: Try coded regex extraction on the FULL content
  const regexResults = extractUrlsWithRegex(blogUrl, contentToSearch, platform);
  console.log(`[Blog Crawl] Coded regex extracted ${regexResults.length} post URLs`);

  if (regexResults.length > 0) {
    return regexResults;
  }

  // Step 2: Fallback to LLM extraction with larger context
  console.log(`[Blog Crawl] Regex found 0 URLs, falling back to LLM extraction`);
  return extractUrlsWithLLM(blogUrl, contentToSearch);
}

async function extractUrlsWithLLM(
  pageUrl: string,
  pageContent: string
): Promise<{ url: string; title: string }[]> {
  // Use a larger slice — 40K chars instead of 12K to catch more content
  const contentSlice = pageContent.slice(0, 40000);

  const prompt = `Extract all individual blog post URLs from this page content.

Look for:
- Links to individual articles/posts (not category pages, not the homepage)
- URLs with dates, slugs, or post IDs
- Links inside article listings, archives, or "recent posts" sections
- Substack post URLs (e.g., /p/post-slug)
- Medium post URLs
- WordPress post URLs

Page URL: ${pageUrl}
Page content (excerpt):
${contentSlice}

Return a JSON array of objects with url and title, most recent first:
[
  { "url": "https://example.com/post-1", "title": "Post Title" },
  ...
]

If URLs are relative, make them absolute using the page URL as base.
If no post URLs found, return: []`;

  try {
    const response = await complete(
      'You are extracting blog post URLs from a webpage.',
      prompt,
      { maxTokens: 4096 }
    );

    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log(`[Blog Crawl] LLM returned no JSON array. Response preview: ${response.slice(0, 200)}`);
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const filtered = parsed.filter((p: any) => p.url && typeof p.url === 'string');
    console.log(`[Blog Crawl] LLM extracted ${filtered.length} post URLs`);
    return filtered;
  } catch (err) {
    console.error('[Blog Crawl] Failed to extract post URLs:', err);
    return [];
  }
}

// ── Generic internal link extraction (for custom/unknown platforms) ──

/**
 * Extract all same-domain internal links from HTML content.
 * Returns URL + anchor text pairs for LLM classification.
 */
function extractInternalLinks(
  baseUrl: string,
  content: string
): { url: string; text: string }[] {
  let origin: string;
  try {
    origin = new URL(baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`).origin;
  } catch {
    return [];
  }

  const links: { url: string; text: string }[] = [];
  const seenUrls = new Set<string>();

  // Match <a href="...">text</a>
  const linkPattern = /href=["']([^"'#]+)["'][^>]*>([^<]*)</gi;
  let match;
  while ((match = linkPattern.exec(content)) !== null) {
    let href = match[1].trim();
    const text = match[2].trim();

    // Skip empty, javascript:, mailto:, tel:, anchors
    if (!href || /^(javascript|mailto|tel):/i.test(href)) continue;

    // Resolve relative URLs
    if (href.startsWith('/')) {
      href = origin + href;
    } else if (!href.startsWith('http')) {
      href = origin + '/' + href;
    }

    // Only keep same-domain links
    try {
      if (new URL(href).origin !== origin) continue;
    } catch {
      continue;
    }

    // Skip common non-content paths
    if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|pdf|zip)(\?|$)/i.test(href)) continue;
    if (/\/(wp-admin|wp-includes|wp-content\/plugins|feed|rss|login|signup|cart|checkout)\b/i.test(href)) continue;

    if (!seenUrls.has(href)) {
      seenUrls.add(href);
      links.push({ url: href, text: text || '' });
    }
  }

  return links;
}

/**
 * LLM fallback: given a list of internal links from a personal domain,
 * ask the LLM which are individual blog posts or essays.
 * Receives only URLs + anchor text, NOT full page HTML — cheap call.
 */
async function classifyBlogLinksWithLLM(
  siteUrl: string,
  subjectName: string,
  links: { url: string; text: string }[]
): Promise<{ url: string; title: string }[]> {
  if (links.length === 0) return [];

  // Format link list compactly
  const linkList = links
    .map(l => `${l.url}${l.text ? ` — ${l.text}` : ''}`)
    .join('\n');

  const prompt = `Here are the internal links from ${subjectName}'s personal website (${siteUrl}).
Which of these are individual blog posts, essays, or articles written by ${subjectName}?

Exclude: navigation pages, about pages, contact pages, category/tag index pages, asset files, home page.
Include: individual posts, essays, articles, letters, reviews, commentary.

Links:
${linkList}

Return ONLY the blog post/essay URLs as a JSON array, most recent first:
[
  { "url": "https://example.com/2024/01/post-title", "title": "Post Title" },
  ...
]

If the anchor text looks like a title, use it. Otherwise use an empty string.
If none of these are blog posts, return: []`;

  try {
    const response = await complete(
      'You are identifying blog posts from a list of website links.',
      prompt,
      { maxTokens: 4096 }
    );

    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log(`[Blog Crawl] LLM link classifier returned no JSON. Preview: ${response.slice(0, 200)}`);
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const filtered = parsed.filter((p: any) => p.url && typeof p.url === 'string');
    console.log(`[Blog Crawl] LLM classified ${filtered.length} links as blog posts`);
    return filtered;
  } catch (err) {
    console.error('[Blog Crawl] LLM link classification failed:', err);
    return [];
  }
}

// ── Authorship verification (gate before bulk crawl) ────────────────

/**
 * After fetching the first post from a discovered blog domain, verify that
 * the target actually wrote it. Uses Sonnet with low temperature for a fast,
 * deterministic yes/no check on byline, author field, and first paragraph.
 *
 * Returns true if the post appears to be written by subjectName.
 */
async function verifyAuthorship(
  postContent: string,
  postUrl: string,
  subjectName: string
): Promise<{ isAuthor: boolean; reason: string }> {
  // Use the first 3000 chars — byline/author info is always at the top
  const contentSlice = postContent.slice(0, 3000);

  const prompt = `Was this post written by "${subjectName}"?

Check these signals (in order of reliability):
1. Byline or "by" attribution
2. Author field / author bio
3. First-person voice in the opening paragraph that identifies the author
4. Substack/Medium/blog "about" text naming the author

Post URL: ${postUrl}
Post content (first 3000 chars):
${contentSlice}

Return JSON only:
{ "isAuthor": true/false, "reason": "one sentence explaining your verdict" }`;

  try {
    const response = await complete(
      'You verify whether a blog post was written by a specific person. Return JSON only.',
      prompt,
      { maxTokens: 256, temperature: 0 }
    );

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Fail-open: if we can't parse the response, let the post through
      console.log(`[Blog Crawl] Authorship check returned unparseable response, failing open for ${postUrl}`);
      return { isAuthor: true, reason: 'Authorship check returned unparseable response — failing open' };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      isAuthor: !!parsed.isAuthor,
      reason: parsed.reason || 'No reason given',
    };
  } catch (err) {
    // Fail-open on API/network errors
    console.error(`[Blog Crawl] Authorship check failed for ${postUrl}:`, err);
    return { isAuthor: true, reason: 'Authorship check errored — failing open' };
  }
}

// ── Personal domain crawler (always fetch, never skip) ──────────────

/**
 * Crawl a personal domain URL (from LinkedIn websites field).
 * Always fetches the page. Tries platform regex first, then falls back
 * to generic link extraction + LLM classification.
 * All results are Tier 1.
 */
export async function crawlPersonalDomain(
  domainUrl: string,
  subjectName: string,
  fetchFunction: (url: string) => Promise<string>
): Promise<ResearchSource[]> {
  console.log(`[Blog Crawl] Crawling personal domain: ${domainUrl}`);

  // Step 1: Always fetch the page
  let pageContent: string;
  try {
    pageContent = await fetchFunction(domainUrl);
  } catch (err) {
    console.log(`[Blog Crawl] Failed to fetch personal domain ${domainUrl}, skipping`);
    return [];
  }

  console.log(`[Blog Crawl] Fetched personal domain: ${pageContent.length} chars`);

  // Step 2: Try platform-specific detection + regex extraction
  const detection = detectBlog(domainUrl, pageContent);
  let posts: { url: string; title: string }[] = [];

  if (detection.isBlog && detection.platform) {
    console.log(`[Blog Crawl] Personal domain matched platform: ${detection.platform}`);
    posts = await extractPostUrls(domainUrl, pageContent, detection.platform, fetchFunction);
  }

  // Step 3: If platform regex found posts, use them
  if (posts.length > 0) {
    console.log(`[Blog Crawl] Platform regex found ${posts.length} posts on personal domain`);
  } else {
    // Step 4: Generic extraction — extract internal links, ask LLM to classify
    console.log(`[Blog Crawl] No platform match — trying generic link extraction + LLM`);
    const internalLinks = extractInternalLinks(domainUrl, pageContent);
    console.log(`[Blog Crawl] Extracted ${internalLinks.length} internal links from ${domainUrl}`);

    if (internalLinks.length > 0) {
      posts = await classifyBlogLinksWithLLM(domainUrl, subjectName, internalLinks);
    }

    if (posts.length === 0) {
      console.log(`[Blog Crawl] No blog posts found on personal domain ${domainUrl} (genuine gap)`);
      return [];
    }
  }

  // Step 5: Prioritize and fetch posts (cap at 12)
  const prioritized = prioritizePosts(posts);
  console.log(`[Blog Crawl] Prioritized to ${prioritized.length} posts from personal domain`);

  // Step 6: Authorship gate — fetch the first post and verify the target wrote it
  if (prioritized.length === 0) return [];

  const firstPost = prioritized[0];
  let firstContent: string;
  try {
    firstContent = await fetchFunction(firstPost.url);
  } catch (err) {
    console.log(`[Blog Crawl] Failed to fetch first post for authorship check: ${firstPost.url}`);
    return [];
  }

  const authorship = await verifyAuthorship(firstContent, firstPost.url, subjectName);
  if (!authorship.isAuthor) {
    console.log(`[Blog Crawl] AUTHORSHIP REJECTED for domain ${domainUrl} — "${authorship.reason}". Discarding all posts from this domain.`);
    return [];
  }

  console.log(`[Blog Crawl] Authorship confirmed for ${domainUrl}: "${authorship.reason}"`);

  // First post already fetched — add it, then fetch the rest
  const sources: ResearchSource[] = [];
  const maxPosts = 12;

  sources.push({
    url: firstPost.url,
    title: firstPost.title || 'Blog Post',
    snippet: firstContent.slice(0, 300),
    content: firstContent,
    source: 'blog_crawl',
    bypassScreening: true,
  });

  for (const post of prioritized.slice(1, maxPosts)) {
    try {
      const content = await fetchFunction(post.url);
      sources.push({
        url: post.url,
        title: post.title || 'Blog Post',
        snippet: content.slice(0, 300),
        content,
        source: 'blog_crawl',
        bypassScreening: true,
      });
      console.log(`[Blog Crawl] Fetched personal domain post: ${post.url} (${content.length} chars)`);
    } catch (err) {
      console.log(`[Blog Crawl] Failed to fetch: ${post.url}`);
    }
  }

  return sources;
}

// ── Post prioritization ─────────────────────────────────────────────

interface PostPriority {
  url: string;
  title: string;
  score: number;
  signals: string[];
}

export function prioritizePosts(posts: { url: string; title: string }[]): PostPriority[] {
  const priorities: PostPriority[] = [];

  for (let i = 0; i < posts.length; i++) {
    const { url, title } = posts[i];
    let score = 0;
    const signals: string[] = [];

    // Recency bonus (assume URLs are ordered recent-first from archive)
    score += Math.max(0, 10 - i * 0.5);

    // Title signals for self-disclosure/methodology
    const highValuePatterns: { pattern: RegExp; label: string }[] = [
      { pattern: /why i|what i learned|how i|my approach|my philosophy|lessons from|reflecting on/i, label: 'Self-disclosure' },
      { pattern: /theory of|framework for|principles of|how we|our approach/i, label: 'Methodology' },
      { pattern: /leaving|joining|starting|building|launching/i, label: 'Career transition' },
      { pattern: /what i think|i believe|my take|my perspective|confession/i, label: 'Values/opinion' },
      { pattern: /letter to|announcement|update on|year in review/i, label: 'Personal update' },
      { pattern: /mistake|failure|wrong|learned the hard way/i, label: 'Vulnerability' },
    ];

    for (const { pattern, label } of highValuePatterns) {
      if (pattern.test(title)) {
        score += 5;
        signals.push(label);
      }
    }

    priorities.push({ url, title, score, signals });
  }

  return priorities
    .sort((a, b) => b.score - a.score)
    .slice(0, 12); // Cap at 12 candidates
}

// ── Blog crawl orchestrator ─────────────────────────────────────────

export async function crawlBlog(
  blogUrl: string,
  subjectName: string,
  fetchFunction: (url: string) => Promise<string>
): Promise<ResearchSource[]> {
  console.log(`[Blog Crawl] Checking ${blogUrl} for blog content`);

  let blogContent: string;
  try {
    blogContent = await fetchFunction(blogUrl);
  } catch (err) {
    console.log(`[Blog Crawl] Failed to fetch ${blogUrl}, skipping`);
    return [];
  }

  const detection = detectBlog(blogUrl, blogContent);

  if (!detection.isBlog) {
    console.log(`[Blog Crawl] ${blogUrl} is not a blog, skipping`);
    return [];
  }

  console.log(`[Blog Crawl] Detected blog platform: ${detection.platform}`);

  // Extract post URLs
  const posts = await extractPostUrls(blogUrl, blogContent, detection.platform, fetchFunction);
  console.log(`[Blog Crawl] Found ${posts.length} post URLs`);

  if (posts.length === 0) return [];

  // Prioritize posts
  const prioritized = prioritizePosts(posts);
  console.log(`[Blog Crawl] Prioritized to ${prioritized.length} posts`);

  if (prioritized.length === 0) return [];

  // Authorship gate — fetch the first post and verify the target wrote it
  const firstPost = prioritized[0];
  let firstContent: string;
  try {
    firstContent = await fetchFunction(firstPost.url);
  } catch (err) {
    console.log(`[Blog Crawl] Failed to fetch first post for authorship check: ${firstPost.url}`);
    return [];
  }

  const authorship = await verifyAuthorship(firstContent, firstPost.url, subjectName);
  if (!authorship.isAuthor) {
    console.log(`[Blog Crawl] AUTHORSHIP REJECTED for blog ${blogUrl} — "${authorship.reason}". Discarding all posts from this blog.`);
    return [];
  }

  console.log(`[Blog Crawl] Authorship confirmed for ${blogUrl}: "${authorship.reason}"`);

  // First post already fetched — add it, then fetch the rest
  const sources: ResearchSource[] = [];
  const maxPosts = 10;

  sources.push({
    url: firstPost.url,
    title: firstPost.title || 'Blog Post',
    snippet: firstContent.slice(0, 300),
    content: firstContent,
    source: 'blog_crawl',
    bypassScreening: true,
  });

  for (const post of prioritized.slice(1, maxPosts)) {
    try {
      const content = await fetchFunction(post.url);
      sources.push({
        url: post.url,
        title: post.title || 'Blog Post',
        snippet: content.slice(0, 300),
        content,
        source: 'blog_crawl',
        bypassScreening: true,
      });
      console.log(`[Blog Crawl] Fetched: ${post.url} (${content.length} chars)`);
    } catch (err) {
      console.log(`[Blog Crawl] Failed to fetch: ${post.url}`);
    }
  }

  return sources;
}

// ── LinkedIn posts discovery ────────────────────────────────────────

export async function findLinkedInPosts(
  subjectName: string,
  searchFunction: (query: string) => Promise<{ url: string; title: string; snippet: string; fullContent?: string }[]>
): Promise<ResearchSource[]> {
  console.log(`[LinkedIn Posts] Searching for ${subjectName}'s LinkedIn activity`);

  const sources: ResearchSource[] = [];

  // Search for LinkedIn posts and articles
  const queries = [
    `site:linkedin.com/posts "${subjectName}"`,
    `site:linkedin.com/pulse "${subjectName}"`,
  ];

  for (const query of queries) {
    try {
      const results = await searchFunction(query);

      // Filter to actual post URLs (not profile, not company pages)
      const postResults = results.filter(r =>
        /linkedin\.com\/posts\/|linkedin\.com\/pulse\//i.test(r.url)
      );

      for (const r of postResults.slice(0, 4)) {
        sources.push({
          url: r.url,
          title: r.title || 'LinkedIn Post',
          snippet: r.snippet,
          content: r.fullContent || r.snippet,
          source: 'linkedin_post',
          bypassScreening: true,
        });
      }
    } catch (err) {
      console.error(`[LinkedIn Posts] Search failed for: ${query}`, err);
    }
  }

  console.log(`[LinkedIn Posts] Found ${sources.length} posts`);
  return sources;
}

// ── Master blog/personal publishing crawler ─────────────────────────

export async function crawlSubjectPublishing(
  subjectName: string,
  seedUrls: string[],
  linkedinData: any | null,
  searchFunction: (query: string) => Promise<{ url: string; title: string; snippet: string; fullContent?: string }[]>,
  fetchFunction: (url: string) => Promise<string>
): Promise<ResearchSource[]> {
  console.log(`[Research] === Crawling Subject's Own Publishing ===`);

  const tier1Sources: ResearchSource[] = [];

  // 1. Check seed URLs for blogs
  for (const url of seedUrls) {
    const blogSources = await crawlBlog(url, subjectName, fetchFunction);
    tier1Sources.push(...blogSources);
  }

  // 2. Check LinkedIn data for personal websites — always crawl, never skip
  if (linkedinData?.websites) {
    for (const website of linkedinData.websites) {
      if (typeof website === 'string' && !website.includes('linkedin.com')) {
        const blogSources = await crawlPersonalDomain(website, subjectName, fetchFunction);
        tier1Sources.push(...blogSources);
      }
    }
  }

  // 3. Search for the subject's personal publishing via Tavily
  try {
    const publishingQueries = [
      `"${subjectName}" substack OR medium OR blog personal writing`,
      `"${subjectName}" author blog post`,
    ];

    for (const query of publishingQueries) {
      const results = await searchFunction(query);
      for (const r of results) {
        // Check if any result points to a blog we haven't crawled yet
        const alreadyCrawled = tier1Sources.some(s => {
          try {
            return new URL(s.url).hostname === new URL(r.url).hostname;
          } catch { return false; }
        });

        if (!alreadyCrawled) {
          const detection = detectBlog(r.url, r.snippet || '');
          if (detection.isBlog) {
            const blogSources = await crawlBlog(r.url, subjectName, fetchFunction);
            tier1Sources.push(...blogSources);
            break; // Only crawl one additional blog
          }
        }
      }
    }
  } catch (err) {
    console.error('[Blog Crawl] Publishing search failed:', err);
  }

  // 4. Find LinkedIn posts
  const linkedinPosts = await findLinkedInPosts(subjectName, searchFunction);
  tier1Sources.push(...linkedinPosts);

  // Deduplicate by URL
  const uniqueUrls = new Set<string>();
  const deduplicated = tier1Sources.filter(s => {
    if (uniqueUrls.has(s.url)) return false;
    uniqueUrls.add(s.url);
    return true;
  });

  console.log(`[Research] Collected ${deduplicated.length} Tier 1 sources from subject's own publishing`);
  return deduplicated;
}
