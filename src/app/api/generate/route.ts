import { NextRequest } from 'next/server';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { runFullPipeline } from '@/lib/pipeline';
import { runConversationPipeline } from '@/lib/conversation-pipeline';
import { sanitizeForClaude } from '@/lib/sanitize';
import { loadExemplars } from '@/lib/canon/loader';
import { withProgressCallback, ProgressEvent, STATUS } from '@/lib/progress';

// Allow long-running generation (5 minutes max for Vercel/Railway)
export const maxDuration = 300;

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
async function webSearch(query: string): Promise<{ url: string; title: string; snippet: string; content?: string }[]> {
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
      content: extractedContent[result.url],
    }));

  } catch (error) {
    console.error('[Search] Tavily search error:', error);
    return [];
  }
}

// SSE endpoint for real-time progress updates
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { donorName, fundraiserName = '', seedUrls = [], mode = 'conversation', linkedinPdf } = body;
  console.log(`[API] Received linkedinPdf: ${linkedinPdf ? `${linkedinPdf.length} chars` : 'none'}`);

  if (!donorName || typeof donorName !== 'string') {
    return new Response(
      JSON.stringify({ error: 'Donor name is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const isConversationMode = mode === 'conversation';
  console.log(`[API] Starting SSE profile generation for: ${donorName} (mode: ${mode})`);

  // Create a readable stream for SSE
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Track whether the controller is still open
      let isControllerClosed = false;

      // Helper to safely send SSE events
      const sendEvent = (event: ProgressEvent) => {
        if (isControllerClosed) {
          console.warn(`[SSE] Attempted to send event after controller closed: ${event.type}`);
          return;
        }
        try {
          const data = JSON.stringify(event);
          const encoded = encoder.encode(`data: ${data}\n\n`);
          console.log(`[SSE] Enqueueing event: ${event.type} (${encoded.length} bytes)`);
          controller.enqueue(encoded);
        } catch (err) {
          // Controller may have been closed by the client disconnecting
          console.error(`[SSE] Failed to enqueue event '${event.type}':`, err);
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

      // Send keep-alive pings every 15 seconds to prevent connection timeout
      const keepAliveInterval = setInterval(() => {
        try {
          if (!isControllerClosed) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'ping' })}\n\n`));
          }
        } catch (e) {
          clearInterval(keepAliveInterval);
        }
      }, 15000);

      try {
        // Run entire pipeline within request-scoped progress context
        // All STATUS.* calls and sendEvent calls must be inside this wrapper
        // so emitProgress() can find the request-scoped callback via AsyncLocalStorage
        await withProgressCallback(sendEvent, async () => {
          try {
            STATUS.pipelineStarted(donorName);

            // Unique request ID for consistent output filenames
            const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const safeName = donorName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');

            // Save outputs helper
            const saveOutputs = (research: any, profile: string, dossier?: string) => {
              const outputDir = '/tmp/prospectai-outputs';
              if (!existsSync(outputDir)) {
                mkdirSync(outputDir, { recursive: true });
              }

              const researchPath = `${outputDir}/${requestId}-${safeName}-research.md`;
              const profilePath = `${outputDir}/${requestId}-${safeName}-profile.md`;

              writeFileSync(researchPath, research.rawMarkdown);
              writeFileSync(profilePath, profile);

              console.log(`[OUTPUT] Research saved to ${researchPath} (${research.rawMarkdown.length} chars)`);
              console.log(`[OUTPUT] Profile saved to ${profilePath} (${profile.length} chars)`);

              if (dossier) {
                const dossierPath = `${outputDir}/${requestId}-${safeName}-dossier.md`;
                writeFileSync(dossierPath, dossier);
                console.log(`[OUTPUT] Dossier saved to ${dossierPath} (${dossier.length} chars)`);
              }

              // Save full research JSON with all source content and excerpts
              try {
                const researchJsonPath = `${outputDir}/${requestId}-${safeName}-research-full.json`;
                const researchJson = {
                  donorName: research.donorName,
                  generatedAt: new Date().toISOString(),
                  identity: research.identity,
                  queries: research.queries,
                  sourceCount: research.sources?.length || 0,
                  sources: (research.sources || []).map((s: any, i: number) => ({
                    index: i + 1,
                    url: s.url,
                    title: s.title,
                    snippet: s.snippet,
                    content: s.content || null,
                  })),
                };
                writeFileSync(researchJsonPath, JSON.stringify(researchJson, null, 2));
                console.log(`[OUTPUT] Full research JSON saved to ${researchJsonPath} (${researchJson.sourceCount} sources)`);
              } catch (err) {
                console.warn('[OUTPUT] Failed to save research JSON:', err);
              }
            };

            // Fetch function for seed URLs using Tavily extract
            const fetchUrl = async (url: string): Promise<string> => {
              if (!TAVILY_API_KEY) {
                // Fallback to direct fetch
                const res = await fetch(url);
                return sanitizeForClaude(await res.text());
              }
              try {
                const extractResponse = await fetch('https://api.tavily.com/extract', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    api_key: TAVILY_API_KEY,
                    urls: [url],
                  }),
                });
                if (extractResponse.ok) {
                  const extractData: TavilyExtractResponse = await extractResponse.json();
                  if (extractData.results.length > 0) {
                    return sanitizeForClaude(extractData.results[0].raw_content);
                  }
                }
              } catch (err) {
                console.warn(`[Fetch] Tavily extract failed for ${url}, falling back to direct fetch`);
              }
              // Fallback to direct fetch
              const res = await fetch(url);
              return sanitizeForClaude(await res.text());
            };

            let result: any;

            if (isConversationMode) {
              // Conversation mode: two-step pipeline (sources → dossier → profile)
              console.log('[API] Running conversation mode pipeline (two-step)...');

              const conversationResult = await runConversationPipeline(
                donorName,
                seedUrls,
                webSearch,
                fetchUrl,
                (message: string, phase?: string, step?: number, totalSteps?: number) => {
                  if (phase && !message) {
                    // Phase transition event
                    sendEvent({ type: 'phase', message: '', phase: phase as any });
                  } else {
                    sendEvent({ type: 'status', phase: phase as any, message, step, totalSteps });
                  }
                },
                linkedinPdf
              );

              // Save outputs including dossier and meeting guide
              saveOutputs(conversationResult.research, conversationResult.profile, conversationResult.dossier);

              // Save meeting guide using same requestId
              if (conversationResult.meetingGuide) {
                const outputDir = '/tmp/prospectai-outputs';
                if (!existsSync(outputDir)) {
                  mkdirSync(outputDir, { recursive: true });
                }
                const meetingGuidePath = `${outputDir}/${requestId}-${safeName}-meeting-guide.md`;
                writeFileSync(meetingGuidePath, conversationResult.meetingGuide);
                console.log(`[OUTPUT] Meeting guide saved to ${meetingGuidePath} (${conversationResult.meetingGuide.length} chars)`);
              }

              // Format result for frontend compatibility
              result = {
                research: conversationResult.research,
                dossier: { rawMarkdown: conversationResult.dossier },
                profile: {
                  donorName,
                  profile: conversationResult.profile,
                  validationPasses: 0,
                  status: 'complete'
                },
                meetingGuide: conversationResult.meetingGuide,
                fundraiserName,
              };

            } else {
              // Standard mode: existing multi-stage pipeline
              console.log('[API] Running standard pipeline...');

              // Load exemplars
              const exemplars = loadExemplars();
              console.log(`[API] Loaded ${exemplars.length} characters of exemplar profiles`);

              result = await runFullPipeline(
                donorName,
                seedUrls,
                webSearch,
                { exemplars }
              );

              // Save outputs
              saveOutputs(result.research, result.profile.profile, result.dossier.rawMarkdown);
            }

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
          }
        }); // end withProgressCallback

      } catch (outerError) {
        // Catch errors from withProgressCallback itself (should be rare)
        console.error('[API] Outer pipeline error:', outerError);
        sendEvent({
          type: 'error',
          message: `Error: ${outerError instanceof Error ? outerError.message : 'Unknown error'}`
        });
      } finally {
        // Stop keep-alive pings
        clearInterval(keepAliveInterval);
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
