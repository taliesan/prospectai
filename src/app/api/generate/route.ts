import { NextRequest } from 'next/server';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { runFullPipeline } from '@/lib/pipeline';
import { sanitizeForClaude } from '@/lib/sanitize';
import { loadExemplars } from '@/lib/canon/loader';
import { withProgressCallback, ProgressEvent, STATUS } from '@/lib/progress';
import { createJob, addProgress, completeJob, failJob, getAbortSignal, updateActivity, clearActivity, linkJobToProfile } from '@/lib/job-store';
import type { DeepResearchActivity } from '@/lib/job-store';

// No timeout config needed — Railway doesn't use Next.js route segment config.
// Deep research (OpenAI o3) can take 5-30 minutes; Tavily pipeline ~5 min.
// Railway timeout is configured via the Railway dashboard or railway.toml.

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
      fullContent: extractedContent[result.url],
    }));

  } catch (error) {
    console.error('[Search] Tavily search error:', error);
    return [];
  }
}

// Fire-and-poll endpoint: starts pipeline in background, returns jobId immediately
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  const body = await request.json();
  const { donorName, fundraiserName = '', seedUrls = [], linkedinPdf, relationshipContext, projectContextId, specificAsk } = body;
  console.log(`[API] Received linkedinPdf: ${linkedinPdf ? `${linkedinPdf.length} chars` : 'none'}`);

  if (!donorName || typeof donorName !== 'string') {
    return Response.json(
      { error: 'Donor name is required' },
      { status: 400 }
    );
  }

  // Create job and start pipeline in background
  const job = await createJob(donorName, userId);
  console.log(`[API] Created job ${job.id} for: ${donorName} (user: ${userId || 'anonymous'})`);

  // Fire-and-forget: run pipeline in background
  // On Railway (persistent container), the process stays alive after response is sent
  runPipelineInBackground(job.id, donorName, fundraiserName, seedUrls, linkedinPdf, userId, relationshipContext, projectContextId, specificAsk).catch((err) => {
    console.error(`[API] Unhandled error in background pipeline for job ${job.id}:`, err);
    failJob(job.id, err instanceof Error ? err.message : 'Unknown error');
  });

  return Response.json({ jobId: job.id });
}

// Background pipeline execution — updates job store with progress
async function runPipelineInBackground(
  jobId: string,
  donorName: string,
  fundraiserName: string,
  seedUrls: string[],
  linkedinPdf?: string,
  userId?: string,
  relationshipContext?: string,
  projectContextId?: string,
  specificAsk?: string,
) {
  // Progress callback writes to job store instead of SSE stream
  const sendEvent = (event: ProgressEvent) => {
    addProgress(jobId, event);
    // Also log for Railway console
    if (event.message) {
      const prefix = event.phase ? `[${event.phase.toUpperCase()}]` : '[Progress]';
      console.log(`[Job ${jobId}] ${prefix} ${event.message}`);
    }
  };

  try {
    await withProgressCallback(sendEvent, async () => {
      try {
        STATUS.pipelineStarted(donorName);

        // Unique request ID for consistent output filenames
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const safeName = donorName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');

        // Save outputs helper
        const saveOutputs = (research: any, profile: string, researchPackage?: string) => {
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

          if (researchPackage) {
            const researchPackagePath = `${outputDir}/${requestId}-${safeName}-research-package.md`;
            writeFileSync(researchPackagePath, researchPackage);
            console.log(`[OUTPUT] Research package saved to ${researchPackagePath} (${researchPackage.length} chars)`);
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

        // CODED PIPELINE — no agent loops, no LLM driving searches
        console.log(`[Job ${jobId}] Running coded pipeline (no agentic loops)...`);

        // Load exemplars
        const exemplars = loadExemplars();
        console.log(`[Job ${jobId}] Loaded ${exemplars.length} characters of exemplar profiles`);

        // Load project context from database if provided
        let projectContextData: import('@/lib/canon/loader').ProjectLayerInput | undefined;
        if (projectContextId && userId) {
          try {
            const pc = await prisma.projectContext.findFirst({
              where: { id: projectContextId, userId },
            });
            if (pc) {
              projectContextData = {
                name: pc.name,
                processedBrief: pc.processedBrief,
                issueAreas: pc.issueAreas || undefined,
                defaultAsk: pc.defaultAsk || undefined,
                specificAsk: specificAsk || undefined,
                fundraiserName: fundraiserName || undefined,
              };
              console.log(`[Job ${jobId}] Loaded project context: ${pc.name} (${pc.processedBrief.length} chars)`);
            }
          } catch (err) {
            console.warn(`[Job ${jobId}] Failed to load project context:`, err);
          }
        }

        // Abort signal from job store — used for user-initiated cancellation
        const abortSignal = getAbortSignal(jobId);

        // Activity callback — deep research reports rich status to the job store
        const onActivity = (activity: DeepResearchActivity, responseId: string) => {
          updateActivity(jobId, responseId, activity);
        };

        const pipelineResult = await runFullPipeline(
          donorName,
          seedUrls,
          webSearch,
          { exemplars },
          (message: string, phase?: string, step?: number, totalSteps?: number) => {
            if (phase && !message) {
              sendEvent({ type: 'phase', message: '', phase: phase as any });
            } else {
              sendEvent({ type: 'status', phase: phase as any, message, step, totalSteps });
            }
          },
          linkedinPdf,
          fetchUrl,
          abortSignal,
          onActivity,
          () => clearActivity(jobId),
          projectContextData,
          relationshipContext,
        );

        // Save outputs
        saveOutputs(
          { ...pipelineResult.research, rawMarkdown: pipelineResult.researchPackage },
          pipelineResult.profile,
          pipelineResult.researchPackage,
        );

        // Save meeting guide
        if (pipelineResult.meetingGuide) {
          const outputDir = '/tmp/prospectai-outputs';
          if (!existsSync(outputDir)) {
            mkdirSync(outputDir, { recursive: true });
          }
          const meetingGuidePath = `${outputDir}/${requestId}-${safeName}-meeting-guide.md`;
          writeFileSync(meetingGuidePath, pipelineResult.meetingGuide);
          console.log(`[OUTPUT] Meeting guide saved to ${meetingGuidePath} (${pipelineResult.meetingGuide.length} chars)`);
        }

        // Format result for frontend compatibility
        result = {
          research: {
            ...pipelineResult.research,
            rawMarkdown: pipelineResult.researchPackage,
            sources: pipelineResult.research.sources || [],
          },
          researchProfile: { rawMarkdown: pipelineResult.profile },
          profile: {
            donorName,
            profile: pipelineResult.profile,
            validationPasses: 0,
            status: 'complete',
          },
          meetingGuide: pipelineResult.meetingGuide,
          fundraiserName,
        };

        STATUS.pipelineComplete();
        console.log(`[Job ${jobId}] Pipeline complete, storing result`);

        // Save profile to Postgres if user is authenticated
        let profileId: string | undefined;
        if (userId) {
          try {
            const dbProfile = await prisma.profile.create({
              data: {
                userId,
                donorName,
                profileMarkdown: pipelineResult.profile,
                meetingGuideMarkdown: pipelineResult.meetingGuide || null,
                researchPackageJson: pipelineResult.researchPackage || null,
                linkedinDataJson: pipelineResult.linkedinData ? JSON.stringify(pipelineResult.linkedinData) : null,
                seedUrlsJson: seedUrls.length > 0 ? JSON.stringify(seedUrls) : null,
                confidenceScores: pipelineResult.confidenceScoresJson || null,
                dimensionCoverage: pipelineResult.dimensionCoverageJson || null,
                sourceCount: pipelineResult.research?.sources?.length || null,
                projectContextId: projectContextId || null,
                relationshipContext: relationshipContext || null,
                fundraiserName: fundraiserName || null,
                specificAsk: specificAsk || null,
                pipelineVersion: 'v6',
                status: 'complete',
              },
            });
            profileId = dbProfile.id;
            console.log(`[Job ${jobId}] Saved profile to database: ${dbProfile.id}`);
            // Link the Job record to this Profile
            await linkJobToProfile(jobId, dbProfile.id);
          } catch (dbErr) {
            console.error(`[Job ${jobId}] Failed to save profile to database:`, dbErr);
            // Don't fail the job — /tmp persistence is the fallback
          }
        }

        // Include profileId in the result so the frontend can navigate by ID
        result.profileId = profileId;

        // Store result in job store for polling retrieval
        completeJob(jobId, result);

      } catch (error) {
        // Don't log abort errors as pipeline errors — they're user-initiated cancellation
        const isAbort = error instanceof Error && (
          error.name === 'AbortError' ||
          error.message === 'Pipeline aborted by client'
        );
        if (isAbort) {
          console.log(`[Job ${jobId}] Pipeline cancelled by user`);
          return;
        }
        console.error(`[Job ${jobId}] Pipeline error:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        STATUS.pipelineError(errorMessage);
        failJob(jobId, errorMessage);
      }
    }); // end withProgressCallback

  } catch (outerError) {
    // Catch errors from withProgressCallback itself (should be rare)
    console.error(`[Job ${jobId}] Outer pipeline error:`, outerError);
    failJob(jobId, outerError instanceof Error ? outerError.message : 'Unknown error');
  }
}
