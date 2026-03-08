/**
 * Phased Research + Single-Call Extraction
 *
 * Pre-Phase: Blog Crawl (coded) — systematically find subject's own publishing
 * Phase 1: Own Voice (Sonnet, agentic) — find everything the subject has written or said
 * Phase 2: Pressure & Context (Sonnet, agentic) — find external evidence, transitions, peer accounts
 * Bulk Fetch: (coded) — parse URLs from Phase 1+2 output, fetch all pages in parallel
 * Screen + Tier: (coded) — automatic/LLM screening, Tier 1/2/3 classification, dedup, enforce targets
 * Extraction: (Opus, single call) — read all source texts, produce 25-30K token research package
 *
 * Phase 3 was previously an agentic Opus session with tools (search + fetch in a loop).
 * It has been replaced by a coded bulk-fetch step followed by a single Opus API call.
 * This eliminates token compounding from the agentic loop and produces a larger, richer
 * extraction at comparable or lower cost.
 *
 * Source quality infrastructure (screening, tiering, blog-crawler) was originally built
 * for the legacy pipeline.ts. It's now wired into this active pipeline path.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { LinkedInData } from '../prompts/extraction-prompt';
import { buildExtractionPrompt } from '../prompts/extraction-prompt';
import { buildResearchBrief } from '../prompts/research-agent-prompt';
import { PHASE_1_SYSTEM_PROMPT } from '../prompts/phase-1-prompt';
import { PHASE_2_SYSTEM_PROMPT } from '../prompts/phase-2-prompt';
import { RESEARCH_TOOLS, executeWebSearch, executeFetchPage } from './tools';
import { runScreeningPipeline, ResearchSource } from './screening';
import {
  tierSources,
  enforceTargets,
  extractLinkedInSlugFromProfile,
  getPersonalDomains,
} from './tiering';
import { crawlSubjectPublishing } from './blog-crawler';

const anthropic = new Anthropic();

// ── Types ───────────────────────────────────────────────────────────

export interface AgentSessionResult {
  output: string;
  toolCallCount: number;
  searchCount: number;
  fetchCount: number;
  conversationLog: any[];
}

export interface FetchedSource {
  url: string;
  title: string;
  snippet: string;
  content: string;
  tier?: number;
  tierReason?: string;
  phase: 1 | 2;
}

export interface PhasedResearchResult {
  researchPackage: string;
  phase1Sources: string;
  phase2Sources: string;
  phase1: AgentSessionResult;
  phase2: AgentSessionResult;
  phase3: AgentSessionResult;   // Kept for interface compat — now the extraction result
  totalSearchCount: number;
  totalFetchCount: number;
  totalToolCallCount: number;
}

// Backward-compatible type alias
export interface ResearchAgentResult {
  researchPackage: string;
  toolCallCount: number;
  searchCount: number;
  fetchCount: number;
  conversationLog: any[];
}

type ProgressCallback = (message: string, phase?: string, step?: number, totalSteps?: number) => void;

// ── Generic Agent Session Runner (Phase 1+2 only) ──────────────────

const MAX_LOOPS = 100;

async function runAgentSession(
  systemPrompt: string,
  userMessage: string,
  onProgress?: (loopCount: number, searchCount: number, fetchCount: number) => void,
  model: string = 'claude-opus-4-20250514',
): Promise<AgentSessionResult> {
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: userMessage },
  ];

  let toolCallCount = 0;
  let searchCount = 0;
  let fetchCount = 0;
  let loopCount = 0;

  while (loopCount < MAX_LOOPS) {
    loopCount++;

    if (onProgress && loopCount % 3 === 0) {
      onProgress(loopCount, searchCount, fetchCount);
    }

    const response = await anthropic.messages.create({
      model,
      max_tokens: 16000,
      system: systemPrompt,
      tools: RESEARCH_TOOLS as any,
      messages,
    });

    // Done — text response with end_turn
    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(
        (c: any): c is Anthropic.Messages.TextBlock => c.type === 'text',
      );
      return {
        output: textBlock?.text || '',
        toolCallCount,
        searchCount,
        fetchCount,
        conversationLog: messages,
      };
    }

    // Execute tool calls
    const toolUseBlocks = response.content.filter(
      (c: any): c is Anthropic.Messages.ToolUseBlock => c.type === 'tool_use',
    );

    if (toolUseBlocks.length === 0) {
      const textBlock = response.content.find(
        (c: any): c is Anthropic.Messages.TextBlock => c.type === 'text',
      );
      if (textBlock) {
        return {
          output: textBlock.text,
          toolCallCount,
          searchCount,
          fetchCount,
          conversationLog: messages,
        };
      }
      break;
    }

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      toolCallCount++;
      const input = toolUse.input as any;

      if (toolUse.name === 'web_search') {
        searchCount++;
        try {
          const results = await executeWebSearch(input.query);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(results),
          });
        } catch (err) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
            is_error: true,
          });
        }
      } else if (toolUse.name === 'fetch_page') {
        fetchCount++;
        try {
          const content = await executeFetchPage(input.url);
          const maxChars = 40000;
          const truncated =
            content.length > maxChars
              ? content.slice(0, maxChars) + '\n\n[Content truncated — page was very long]'
              : content;
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: truncated,
          });
        } catch (err) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: `Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
            is_error: true,
          });
        }
      } else {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: `Unknown tool: ${toolUse.name}`,
          is_error: true,
        });
      }
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });
  }

  // Hit loop limit
  return {
    output: `[Agent reached ${MAX_LOOPS} iteration limit. Partial results may be available in the conversation log.]`,
    toolCallCount,
    searchCount,
    fetchCount,
    conversationLog: messages,
  };
}

// ── URL Parsing from Phase 1+2 Output ──────────────────────────────

/**
 * Extract URLs from the numbered source lists produced by Phase 1 and Phase 2.
 * Phase outputs contain lines like:
 *   - URL: https://example.com/some-page
 *   - https://example.com/some-page
 *   - 1. https://example.com/some-page — Blog post about...
 * Also picks up bare URLs on their own line.
 */
function parseUrlsFromPhaseOutput(output: string): string[] {
  const urls = new Set<string>();

  // Match URLs after "URL:" prefix (common in agent output)
  const urlPrefixPattern = /URL:\s*(https?:\/\/[^\s,)>\]]+)/gi;
  let match;
  while ((match = urlPrefixPattern.exec(output)) !== null) {
    urls.add(match[1].replace(/[.,;:]+$/, ''));
  }

  // Match bare URLs (lines starting with http or after a number)
  const bareUrlPattern = /(?:^|\s)(https?:\/\/[^\s,)>\]]+)/gm;
  while ((match = bareUrlPattern.exec(output)) !== null) {
    urls.add(match[1].replace(/[.,;:]+$/, ''));
  }

  return Array.from(urls);
}

/**
 * Extract title hints from phase output for a given URL.
 * Looks for patterns like: "Title: Something" or "Some Title — https://..."
 */
function extractTitleForUrl(output: string, url: string): string {
  // Look for "Title: X" near the URL
  const urlEscaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const titlePattern = new RegExp(`Title:\\s*(.+?)\\n[\\s\\S]{0,200}${urlEscaped}`, 'i');
  const match = output.match(titlePattern);
  if (match) return match[1].trim();

  // Look for text before the URL on the same line
  const linePattern = new RegExp(`^.*?([^\\n]{5,80})\\s*[-—]\\s*${urlEscaped}`, 'im');
  const lineMatch = output.match(linePattern);
  if (lineMatch) return lineMatch[1].trim().replace(/^\d+\.\s*/, '');

  // Derive from URL path
  const pathSegments = new URL(url).pathname.split('/').filter(Boolean);
  const lastSegment = pathSegments[pathSegments.length - 1] || '';
  return lastSegment
    .replace(/[-_]/g, ' ')
    .replace(/\.\w+$/, '')
    .trim() || url;
}

// ── Bulk Parallel Fetch ─────────────────────────────────────────────

const FETCH_CONCURRENCY = 8;

/**
 * Fetch all URLs in parallel with concurrency limit.
 * Returns FetchedSource[] with full page content.
 */
async function bulkFetchSources(
  urls: string[],
  phaseOutputs: { phase1: string; phase2: string },
  onProgress?: (fetched: number, total: number) => void,
): Promise<FetchedSource[]> {
  const results: FetchedSource[] = [];
  const queue = [...urls];
  let fetched = 0;
  let active = 0;

  // Determine which phase each URL came from
  const phase1Urls = new Set(parseUrlsFromPhaseOutput(phaseOutputs.phase1));

  async function processOne(url: string): Promise<void> {
    try {
      const content = await executeFetchPage(url);
      if (content && !content.startsWith('Failed to fetch')) {
        const phase = phase1Urls.has(url) ? 1 : 2;
        const title = extractTitleForUrl(
          phase === 1 ? phaseOutputs.phase1 : phaseOutputs.phase2,
          url,
        );
        results.push({
          url,
          title,
          snippet: content.slice(0, 300),
          content,
          phase: phase as 1 | 2,
        });
      } else {
        console.log(`[Bulk Fetch] Failed: ${url}`);
      }
    } catch (err) {
      console.log(`[Bulk Fetch] Error fetching ${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
    fetched++;
    if (onProgress) onProgress(fetched, urls.length);
  }

  // Process with concurrency limit
  const executing = new Set<Promise<void>>();

  for (const url of queue) {
    const p = processOne(url).then(() => {
      executing.delete(p);
    });
    executing.add(p);

    if (executing.size >= FETCH_CONCURRENCY) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);

  console.log(`[Bulk Fetch] Fetched ${results.length}/${urls.length} sources successfully`);
  return results;
}

// ── Single-Call Opus Extraction ─────────────────────────────────────

/**
 * Run the extraction as a single Opus API call.
 * No tools, no loop, no token compounding.
 * Input: full source texts + extraction instructions.
 * Output: 25-30K token research package.
 */
async function runExtractionCall(
  donorName: string,
  sources: { url: string; title: string; snippet: string; content?: string; tier?: number; tierReason?: string }[],
  linkedinData: LinkedInData | null,
): Promise<string> {
  const prompt = buildExtractionPrompt(donorName, sources, linkedinData);

  const promptTokenEstimate = Math.ceil(prompt.length / 4);
  console.log(`[Extraction] Prompt size: ${prompt.length} chars (~${promptTokenEstimate} tokens)`);
  console.log(`[Extraction] Sources included: ${sources.length}`);
  console.log(`[Extraction] Requesting max 32000 output tokens from Opus`);

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-20250514',
    max_tokens: 32000,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find(
    (c: any): c is Anthropic.Messages.TextBlock => c.type === 'text',
  );

  const output = textBlock?.text || '';
  const outputTokenEstimate = Math.ceil(output.length / 4);
  console.log(`[Extraction] Output: ${output.length} chars (~${outputTokenEstimate} tokens)`);
  console.log(`[Extraction] Input tokens (API): ${response.usage?.input_tokens}`);
  console.log(`[Extraction] Output tokens (API): ${response.usage?.output_tokens}`);

  return output;
}

// ── Phased Research Orchestration ───────────────────────────────────

export async function runPhasedResearch(
  linkedinData: LinkedInData | null,
  subjectName: string,
  onProgress?: ProgressCallback,
): Promise<PhasedResearchResult> {
  const emit = onProgress || (() => {});
  const TOTAL_STEPS = 38;

  console.log(`[Research] Starting phased research for: ${subjectName}`);

  const briefBase = buildResearchBrief(linkedinData, subjectName);

  // Derive subject's LinkedIn slug and personal domains for tiering
  const linkedInSlug = linkedinData
    ? extractLinkedInSlugFromProfile(`/in/${(linkedinData as any).linkedinSlug || ''}`)
    : null;
  const personalDomains = linkedinData ? getPersonalDomains(linkedinData) : [];
  console.log(`[Research] LinkedIn slug: ${linkedInSlug || 'none'}, personal domains: ${personalDomains.join(', ') || 'none'}`);

  // ── Pre-Phase: Blog Crawl (coded, before agentic discovery) ────
  emit('Crawling subject\'s own publishing...', 'research', 3, TOTAL_STEPS);
  console.log(`[Research] Pre-phase: Blog crawl for ${subjectName}`);

  let blogCrawlSources: ResearchSource[] = [];
  try {
    blogCrawlSources = await crawlSubjectPublishing(
      subjectName,
      [],   // seed URLs — could pass from pipeline if available
      linkedinData,
      async (query: string) => {
        const results = await executeWebSearch(query);
        return results.map(r => ({ url: r.url, title: r.title, snippet: r.snippet }));
      },
      executeFetchPage,
    );
    console.log(`[Research] Blog crawl found ${blogCrawlSources.length} Tier 1 sources`);
  } catch (err) {
    console.error(`[Research] Blog crawl failed:`, err);
  }

  emit(
    blogCrawlSources.length > 0
      ? `Found ${blogCrawlSources.length} sources from subject's own publishing. Starting Phase 1...`
      : 'No personal publishing found. Starting Phase 1...',
    'research', 4, TOTAL_STEPS,
  );

  // ── Phase 1: Own Voice (Sonnet — source discovery, not extraction) ─
  console.log(`[Research] Phase 1: Own Voice (Sonnet)`);

  const phase1 = await runAgentSession(
    PHASE_1_SYSTEM_PROMPT,
    briefBase + '\n\nBegin your research.',
    (loop, searches, fetches) => {
      emit(
        `Phase 1 (own voice): ${searches} searches, ${fetches} pages...`,
        'research',
        Math.min(3 + Math.floor(loop / 3), 7),
        TOTAL_STEPS,
      );
    },
    'claude-sonnet-4-20250514',
  );

  console.log(`[Research] Phase 1 complete: ${phase1.searchCount} searches, ${phase1.fetchCount} fetches, ${phase1.output.length} chars`);
  emit(
    `Phase 1 complete — ${phase1.searchCount} searches, ${phase1.fetchCount} pages. Starting Phase 2...`,
    'research', 8, TOTAL_STEPS,
  );

  // ── Phase 2: Pressure & Context (Sonnet — source discovery) ────
  console.log(`[Research] Phase 2: Pressure & Context (Sonnet)`);

  const phase2 = await runAgentSession(
    PHASE_2_SYSTEM_PROMPT,
    briefBase +
      '\n\n## Sources Already Found (Phase 1)\n\n' + phase1.output +
      '\n\nBegin your research.',
    (loop, searches, fetches) => {
      emit(
        `Phase 2 (external evidence): ${searches} searches, ${fetches} pages...`,
        'research',
        Math.min(8 + Math.floor(loop / 3), 11),
        TOTAL_STEPS,
      );
    },
    'claude-sonnet-4-20250514',
  );

  console.log(`[Research] Phase 2 complete: ${phase2.searchCount} searches, ${phase2.fetchCount} fetches, ${phase2.output.length} chars`);
  emit(
    `Phase 2 complete — ${phase2.searchCount} searches, ${phase2.fetchCount} pages. Fetching all sources...`,
    'research', 12, TOTAL_STEPS,
  );

  // ── Bulk Fetch: Parse URLs and fetch all pages in parallel ─────
  console.log(`[Research] Bulk fetch: parsing URLs from Phase 1+2 outputs...`);

  const phase1Urls = parseUrlsFromPhaseOutput(phase1.output);
  const phase2Urls = parseUrlsFromPhaseOutput(phase2.output);
  const allUrls = Array.from(new Set(phase1Urls.concat(phase2Urls)));

  console.log(`[Research] Found ${phase1Urls.length} URLs from Phase 1, ${phase2Urls.length} from Phase 2 (${allUrls.length} unique)`);
  emit(
    `Fetching ${allUrls.length} source pages in parallel...`,
    'research', 12, TOTAL_STEPS,
  );

  const fetchedSources = await bulkFetchSources(
    allUrls,
    { phase1: phase1.output, phase2: phase2.output },
    (fetched, total) => {
      if (fetched % 5 === 0 || fetched === total) {
        emit(
          `Fetched ${fetched}/${total} source pages...`,
          'research',
          Math.min(12 + Math.floor((fetched / total) * 2), 13),
          TOTAL_STEPS,
        );
      }
    },
  );

  const bulkFetchCount = fetchedSources.length;
  console.log(`[Research] Bulk fetch complete: ${bulkFetchCount} sources with content`);

  // ── Merge blog crawl sources with bulk-fetched sources ─────────
  // Blog crawl sources are already fetched with content — add them
  const blogCrawlUrls = new Set(blogCrawlSources.map(s => s.url));
  const mergedSources: ResearchSource[] = [
    // Blog crawl sources first (already Tier 1, already fetched)
    ...blogCrawlSources,
    // Then bulk-fetched sources (skip duplicates from blog crawl)
    ...fetchedSources.filter(s => !blogCrawlUrls.has(s.url)),
  ];
  console.log(`[Research] Merged sources: ${blogCrawlSources.length} blog crawl + ${fetchedSources.length - (fetchedSources.length - mergedSources.length + blogCrawlSources.length)} bulk fetch = ${mergedSources.length} total`);

  // ── Screening: automatic + LLM screening + dedup ───────────────
  emit('Screening and classifying sources...', 'research', 13, TOTAL_STEPS);
  console.log(`[Research] Running screening pipeline on ${mergedSources.length} sources`);

  const screeningResult = await runScreeningPipeline(
    mergedSources,
    subjectName,
    linkedinData,
  );
  const screenedSources = screeningResult.survivingUrls;
  const screeningStats = screeningResult.stats;

  console.log(`[Research] Screening: ${mergedSources.length} → ${screenedSources.length} sources`);
  console.log(`[Research] Screening stats: ${JSON.stringify(screeningStats)}`);

  // ── Tiering: classify Tier 1/2/3 + enforce targets ─────────────
  const tieredSources = tierSources(screenedSources, subjectName, linkedInSlug || undefined, personalDomains);
  const { selected: selectedSources, warnings: tierWarnings } = enforceTargets(tieredSources);

  const tier1Count = selectedSources.filter(s => s.tier === 1).length;
  const tier2Count = selectedSources.filter(s => s.tier === 2).length;
  const tier3Count = selectedSources.filter(s => s.tier === 3).length;
  console.log(`[Research] Tiered: ${tier1Count} T1, ${tier2Count} T2, ${tier3Count} T3 (${selectedSources.length} total)`);

  if (tierWarnings.length > 0) {
    for (const w of tierWarnings) console.log(`[Research] ${w}`);
  }

  emit(
    `${selectedSources.length} sources selected (${tier1Count} own voice, ${tier2Count} third-party, ${tier3Count} background). Extracting...`,
    'research', 14, TOTAL_STEPS,
  );

  // ── Extraction: Single Opus call (no tools, no loop) ───────────
  console.log(`[Research] Extraction: single Opus call with ${selectedSources.length} sources`);
  emit(
    `Extracting behavioral evidence from ${selectedSources.length} sources (Opus)...`,
    'research', 14, TOTAL_STEPS,
  );

  const researchPackage = await runExtractionCall(subjectName, selectedSources, linkedinData);

  const totalSearches = phase1.searchCount + phase2.searchCount;
  const totalFetches = phase1.fetchCount + phase2.fetchCount + bulkFetchCount + blogCrawlSources.length;
  const totalTools = phase1.toolCallCount + phase2.toolCallCount;

  console.log(`[Research] Extraction complete: ${researchPackage.length} chars (~${Math.ceil(researchPackage.length / 4)} tokens)`);
  console.log(`[Research] All phases complete: ${totalSearches} total searches, ${totalFetches} total fetches, ${totalTools} total tool calls`);
  console.log(`[Research] Source composition: ${tier1Count} T1, ${tier2Count} T2, ${tier3Count} T3 → ${selectedSources.length} to extraction`);

  emit(
    `Research complete — ${totalSearches} searches, ${totalFetches} pages read, ${selectedSources.length} sources selected, extraction: ~${Math.ceil(researchPackage.length / 4)} tokens`,
    'research', 15, TOTAL_STEPS,
  );

  // Build a synthetic Phase 3 result for interface compatibility
  const phase3Compat: AgentSessionResult = {
    output: researchPackage,
    toolCallCount: 0,
    searchCount: 0,
    fetchCount: bulkFetchCount,
    conversationLog: [],
  };

  return {
    researchPackage,
    phase1Sources: phase1.output,
    phase2Sources: phase2.output,
    phase1,
    phase2,
    phase3: phase3Compat,
    totalSearchCount: totalSearches,
    totalFetchCount: totalFetches,
    totalToolCallCount: totalTools,
  };
}

// ── Backward-compatible wrapper ─────────────────────────────────────

/**
 * @deprecated Use runPhasedResearch() instead. This wrapper exists for
 * backward compatibility during migration.
 */
export async function runResearchAgent(
  linkedinData: LinkedInData | null,
  subjectName: string,
  onProgress?: ProgressCallback,
): Promise<ResearchAgentResult> {
  const result = await runPhasedResearch(linkedinData, subjectName, onProgress);
  return {
    researchPackage: result.researchPackage,
    toolCallCount: result.totalToolCallCount,
    searchCount: result.totalSearchCount,
    fetchCount: result.totalFetchCount,
    conversationLog: [],
  };
}
