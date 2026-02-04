import { NextRequest, NextResponse } from 'next/server';
import { runFullPipeline } from '@/lib/pipeline';
import { sanitizeForClaude } from '@/lib/sanitize';
import { loadExemplars } from '@/lib/canon/loader';

// Tavily API configuration
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

interface TavilySearchResult {
  url: string;
  title: string;
  content: string;
  score: number;
}

interface TavilySearchResponse {
  results: TavilySearchResult[];
}

interface TavilyExtractResponse {
  results: {
    url: string;
    raw_content: string;
  }[];
}

// Web search using Tavily API
async function webSearch(query: string): Promise<{ url: string; title: string; snippet: string; fullContent?: string }[]> {
  console.log(`[Search] Query: ${query}`);

  if (!TAVILY_API_KEY) {
    console.warn('[Search] TAVILY_API_KEY not set, returning empty results');
    return [];
  }

  try {
    // Step 1: Search for results
    const searchResponse = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: 'advanced',
        include_answer: false,
        max_results: 10,
      }),
    });

    if (!searchResponse.ok) {
      console.error(`[Search] Tavily search failed: ${searchResponse.status}`);
      return [];
    }

    const searchData: TavilySearchResponse = await searchResponse.json();

    // Step 2: Extract full content for high-value sources (top 3 by score)
    const topResults = searchData.results
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const urlsToExtract = topResults.map(r => r.url);

    let extractedContent: Record<string, string> = {};

    if (urlsToExtract.length > 0) {
      try {
        const extractResponse = await fetch('https://api.tavily.com/extract', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            api_key: TAVILY_API_KEY,
            urls: urlsToExtract,
          }),
        });

        if (extractResponse.ok) {
          const extractData: TavilyExtractResponse = await extractResponse.json();
          extractedContent = extractData.results.reduce((acc, item) => {
            // Strip images from raw_content to prevent Claude API from parsing them as media
            acc[item.url] = sanitizeForClaude(item.raw_content);
            return acc;
          }, {} as Record<string, string>);
        }
      } catch (extractError) {
        console.warn('[Search] Tavily extract failed, continuing with snippets only:', extractError);
      }
    }

    // Step 3: Return combined results
    return searchData.results.map(result => ({
      url: result.url,
      title: result.title,
      snippet: result.content,
      fullContent: extractedContent[result.url],
    }));

  } catch (error) {
    console.error('[Search] Tavily search error:', error);
    return [];
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { donorName, seedUrls = [] } = body;

    if (!donorName || typeof donorName !== 'string') {
      return NextResponse.json(
        { error: 'Donor name is required' },
        { status: 400 }
      );
    }

    console.log(`[API] Starting profile generation for: ${donorName}`);

    // Load all 11 exemplar profiles from file
    const exemplars = loadExemplars();
    console.log(`[API] Loaded ${exemplars.length} characters of exemplar profiles`);

    const result = await runFullPipeline(
      donorName,
      seedUrls,
      webSearch,
      { exemplars }
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] Error:', error);
    return NextResponse.json(
      { error: 'Profile generation failed' },
      { status: 500 }
    );
  }
}
