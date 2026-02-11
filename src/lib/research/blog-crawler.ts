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

  // Fetch top posts
  const sources: ResearchSource[] = [];
  const maxPosts = 10;

  for (const post of prioritized.slice(0, maxPosts)) {
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

  // 2. Check LinkedIn data for personal websites
  if (linkedinData?.websites) {
    for (const website of linkedinData.websites) {
      if (typeof website === 'string' && !website.includes('linkedin.com')) {
        const blogSources = await crawlBlog(website, subjectName, fetchFunction);
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
