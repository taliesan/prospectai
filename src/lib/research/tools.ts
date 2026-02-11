/**
 * Tool definitions and execution wrappers for the research agent.
 *
 * Two tools:
 *   web_search — Tavily Search API (returns top 10 results with snippets)
 *   fetch_page — Tavily Extract API (returns full page content), falls back to direct fetch
 */

import { sanitizeForClaude } from '../sanitize';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

// ── Anthropic tool definitions ──────────────────────────────────────

export const WEB_SEARCH_TOOL = {
  name: 'web_search' as const,
  description:
    'Search the web. Returns up to 10 results with titles, URLs, and content snippets. Keep queries short and specific (3-8 words). Use quotes around the subject\'s name for precision.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string' as const,
        description: 'Search query',
      },
    },
    required: ['query'],
  },
};

export const FETCH_PAGE_TOOL = {
  name: 'fetch_page' as const,
  description:
    'Fetch the full text content of a web page. Use after web_search to read promising results in full. Returns cleaned text (no images/scripts). For LinkedIn post URLs, the content may include unrelated posts from the "More Relevant Posts" feed — focus on the primary post at the top.',
  input_schema: {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string' as const,
        description: 'URL to fetch',
      },
    },
    required: ['url'],
  },
};

export const RESEARCH_TOOLS = [WEB_SEARCH_TOOL, FETCH_PAGE_TOOL];

// ── Tool execution ──────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function executeWebSearch(query: string): Promise<SearchResult[]> {
  console.log(`[Research Agent] Searching: "${query}"`);

  if (!TAVILY_API_KEY) {
    console.warn('[Research Agent] TAVILY_API_KEY not set, returning empty results');
    return [];
  }

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: 'advanced',
        include_answer: false,
        max_results: 10,
      }),
    });

    if (!response.ok) {
      console.error(`[Research Agent] Tavily search failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return (data.results || []).map((r: any) => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.content || '',
    }));
  } catch (err) {
    console.error('[Research Agent] Search error:', err);
    return [];
  }
}

export async function executeFetchPage(url: string): Promise<string> {
  console.log(`[Research Agent] Fetching: ${url}`);

  // Primary: Tavily Extract API
  if (TAVILY_API_KEY) {
    try {
      const response = await fetch('https://api.tavily.com/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: TAVILY_API_KEY,
          urls: [url],
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.results && data.results.length > 0) {
          const content = sanitizeForClaude(data.results[0].raw_content);
          console.log(`[Research Agent] Fetched via Tavily Extract: ${content.length} chars`);
          return content;
        }
      }
    } catch (err) {
      console.warn(`[Research Agent] Tavily extract failed for ${url}, falling back to direct fetch`);
    }
  }

  // Fallback: direct HTTP fetch
  try {
    const response = await fetch(url);
    const text = await response.text();
    const content = sanitizeForClaude(text);
    console.log(`[Research Agent] Fetched via direct fetch: ${content.length} chars`);
    return content;
  } catch (err) {
    const message = `Failed to fetch ${url}: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[Research Agent] ${message}`);
    return message;
  }
}
