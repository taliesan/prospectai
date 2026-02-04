import { NextRequest } from 'next/server';
import { runFullPipeline } from '@/lib/pipeline';
import { sanitizeForClaude } from '@/lib/sanitize';
import { loadExemplars } from '@/lib/canon/loader';
import { setProgressCallback, ProgressEvent, STATUS } from '@/lib/progress';

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

// SSE endpoint for real-time progress updates
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { donorName, seedUrls = [] } = body;

  if (!donorName || typeof donorName !== 'string') {
    return new Response(
      JSON.stringify({ error: 'Donor name is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  console.log(`[API] Starting SSE profile generation for: ${donorName}`);

  // Create a readable stream for SSE
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Track whether the controller is still open
      let isControllerClosed = false;

      // Helper to safely send SSE events
      const sendEvent = (event: ProgressEvent) => {
        if (isControllerClosed) {
          console.warn('[SSE] Attempted to send event after controller closed:', event.type);
          return;
        }
        try {
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch (err) {
          // Controller may have been closed by the client disconnecting
          console.warn('[SSE] Failed to enqueue event (controller may be closed):', err);
          isControllerClosed = true;
        }
      };

      // Helper to safely close the controller
      const safeClose = () => {
        if (isControllerClosed) {
          console.log('[SSE] Controller already closed, skipping close()');
          return;
        }
        try {
          controller.close();
          isControllerClosed = true;
          console.log('[SSE] Controller closed successfully');
        } catch (err) {
          console.warn('[SSE] Failed to close controller:', err);
          isControllerClosed = true;
        }
      };

      // Set up progress callback
      setProgressCallback(sendEvent);

      try {
        // Load exemplars
        const exemplars = loadExemplars();
        console.log(`[API] Loaded ${exemplars.length} characters of exemplar profiles`);

        STATUS.pipelineStarted(donorName);

        // Run the full pipeline
        const result = await runFullPipeline(
          donorName,
          seedUrls,
          webSearch,
          { exemplars }
        );

        // Log full outputs for Railway logs
        console.log(`[OUTPUT:RESEARCH]\n${result.research.rawMarkdown}\n[/OUTPUT:RESEARCH]`);
        console.log(`[OUTPUT:DOSSIER]\n${result.dossier.rawMarkdown}\n[/OUTPUT:DOSSIER]`);
        console.log(`[OUTPUT:PROFILE]\n${result.profile.profile}\n[/OUTPUT:PROFILE]`);

        STATUS.pipelineComplete();

        // Send the final result - this is the critical event that must reach the client
        console.log('[SSE] Sending final complete event with profile data...');
        sendEvent({
          type: 'complete',
          message: 'Profile generation complete',
          detail: JSON.stringify(result)
        });
        console.log('[SSE] Final complete event sent successfully');

      } catch (error) {
        console.error('[API] Pipeline error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        STATUS.pipelineError(errorMessage);

        sendEvent({
          type: 'error',
          message: `Error: ${errorMessage}`
        });
      } finally {
        // Clear progress callback first
        setProgressCallback(null);
        // Then safely close the controller
        safeClose();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
