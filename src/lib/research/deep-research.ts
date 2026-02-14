// Stage 6 — Research Synthesis (v5 Pipeline)
//
// Deep Research is the analyst, not the searcher. Its primary job is to read
// every pre-fetched source, extract behavioral evidence with key quotes,
// identify cross-source patterns and contradictions, and produce a structured
// research package organized by behavioral dimension.
//
// Web search is available only as a limited gap-fill pass (max 20 searches)
// after all pre-loaded content has been processed.

import OpenAI from 'openai';
import { LinkedInData } from '../prompts/extraction-prompt';
import { writeFileSync, mkdirSync } from 'fs';
import type { DeepResearchActivity, ActivityCallback } from '../job-store';
import { formatDimensionsForPrompt, DIMENSIONS, dimKey } from '../dimensions';
import type { ScoredSource, CoverageGap } from '../prompts/source-scoring';

// ── Types ─────────────────────────────────────────────────────────

export interface DeepResearchResult {
  dossier: string;
  citations: DeepResearchCitation[];
  searchCount: number;
  tokenUsage: {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
  };
  durationMs: number;
  researchStrategy: string;
  evidenceDensity?: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface DeepResearchCitation {
  title: string;
  url: string;
  startIndex: number;
  endIndex: number;
}

type ProgressCallback = (message: string, phase?: string, step?: number, totalSteps?: number) => void;

// ── Developer Message (Sections A-F) ─────────────────────────────

function buildDeveloperMessage(
  subjectName: string,
  numSources: number,
  coverageGapReport: string,
  linkedinJson: string,
): string {
  // Section A — Task Definition & Bounded Synthesis
  const sectionA = `You are a behavioral research analyst producing a dossier on ${subjectName}. Your output feeds a downstream profiling system that writes persuasion profiles and meeting guides. Your job has three layers:

LAYER 1 — EXTRACTION (primary):
- Read source documents
- Identify passages with behavioral evidence
- Extract key quotes (50-300 words each) that preserve the subject's original voice and the source's original framing
- Tag each quote to one or more of the 25 behavioral dimensions

LAYER 2 — PATTERN IDENTIFICATION (secondary):
- When you see the same behavioral pattern across multiple sources, flag it: "CROSS-SOURCE PATTERN: [description]"
- When you see a contradiction between stated values and observed actions, flag it: "CONTRADICTION: [description]"
- When you see a behavioral pattern that only appears under specific conditions, flag it: "CONDITIONAL: If [trigger], then [behavior]"
- These flags should be 2-4 sentences. Identify the pattern and cite the sources that support it. Do not write profile prose.

LAYER 3 — GAP REPORTING (tertiary):
- After processing all sources, report which dimensions have strong evidence, which have thin evidence, and which have none
- For thin or missing dimensions, note what type of source would be needed (e.g., "RETREAT_PATTERNS: would require interview footage or crisis coverage showing how subject disengages")

Your job is NOT:
- Writing a finished behavioral profile or persuasion document
- Producing a readable narrative for an end user
- Paraphrasing source material when the original language is stronger
- Editorializing about the subject's character

The downstream profiler needs BOTH the subject's original language AND your analytical flags identifying patterns across sources. Pure quotes without pattern identification leave too much work for the profiler. Pure analysis without quotes strips the evidence. Both layers are required.

MANDATORY SOURCE PROCESSING: You have been provided with ${numSources} pre-fetched source documents in the user message below. These are your PRIMARY evidence base. They have been pre-screened for relevance and verified as pertaining to the correct individual.

YOU MUST:
- Read every single pre-fetched source in full
- Extract behavioral evidence from every source
- Reference each source at least once in your output, or note why it contained no usable behavioral evidence

If your output does not reference all ${numSources} pre-fetched sources, review your work and fill the gaps. Do not skip sources because you feel you have "enough evidence."

OUTPUT REQUIREMENTS:
- Target length: 30,000-60,000 characters
- If your output is under 25,000 characters, you stopped too early
- Organize entries by behavioral dimension, not by source. Group evidence under each dimension heading so the downstream profiler can see all evidence for DECISION_MAKING together, all evidence for TRUST_CALIBRATION together, etc.
- For each dimension: lead with the strongest quotes, follow with supporting quotes, then add your CROSS-SOURCE PATTERN or CONTRADICTION flags if applicable
- Report evidence gaps honestly: "No usable behavioral evidence found" for dimensions with no coverage`;

  // Section B — 25 Behavioral Dimensions
  const sectionB = `BEHAVIORAL DIMENSIONS (with investment tiers):

${formatDimensionsForPrompt()}`;

  // Section C — Coverage Gap Report from Stage 5
  const sectionC = coverageGapReport;

  // Section D — Search Behavior Instructions
  const sectionD = `SEARCH BEHAVIOR — READ FIRST, THEN GAP-FILL:

Your workflow has two phases:

PHASE 1 — MANDATORY CONTENT PROCESSING (do this FIRST):
Read all ${numSources} pre-fetched sources provided in the user message. For each source, extract key quotes and tag them to behavioral dimensions. When you see patterns across multiple sources, flag them (CROSS-SOURCE PATTERN, CONTRADICTION, CONDITIONAL). Do not begin any web searches until you have processed every pre-fetched source.

PHASE 2 — LIMITED GAP-FILL SEARCH (do this SECOND):
After Phase 1, review your dimension coverage. For any HIGH-TIER dimension with fewer than 4 evidence entries, or any dimension with ZERO entries, conduct targeted web searches to try to fill the gap.

CONSTRAINTS ON PHASE 2:
- Maximum 15-20 web searches total. This is not a full research pass.
- Search ONLY for specific gaps identified in the coverage analysis. Do not repeat searches for dimensions already well-covered by pre-fetched sources.
- If a web search returns a source already provided in the pre-fetched material, skip it — do not duplicate.
- If gap-fill searches return nothing useful, report the gap honestly. An honest "no evidence found" is better than thin inference.

ANTI-TRUNCATION:
Extract quotes from ALL behaviorally relevant passages in your sources, not just the best ones. If a source contains 5 relevant passages, extract all 5. After extraction, identify cross-source patterns — these analytical flags are what make your output more valuable than a raw quote dump.

Your output should be closer to 50,000 characters than 20,000. If your output is under 25,000 characters, you have not extracted enough or identified enough patterns. Go back to your sources.`;

  // Section E — Source Attribution Guidance
  const sectionE = `SOURCE ATTRIBUTION:
Some pre-fetched sources are tagged with attribution type. Carry the tag through to your output so the downstream profiler knows the evidence weight:

- "target_authored" — Direct voice. Quote the subject's own words.
- "target_coverage" — Third-party coverage. Quote only passages where the subject is directly quoted or their specific actions are described. Do not extract the journalist's general framing.
- "institutional_inference" — What the org did during the subject's tenure, in their area of responsibility. The subject may not be named. Extract the passage describing the institutional action. Tag as institutional_inference so the downstream profiler can calibrate confidence and apply hedged attribution.
- "target_reshare" — Subject shared someone else's content with their own commentary. Extract ONLY the subject's original commentary, not the reshared content.

Before extracting any quote, verify the passage is attributable to ${subjectName} or to an institution acting within their area of responsibility. Do not extract quotes from other individuals whose content the subject merely interacted with.`;

  // Section F — LinkedIn Data
  const sectionF = `CANONICAL BIOGRAPHICAL DATA:
${linkedinJson}`;

  return [sectionA, sectionB, sectionC, sectionD, sectionE, sectionF].join('\n\n---\n\n');
}

// ── Legacy User Message (for when Stage 5 hasn't run) ───────────────

function buildLegacyUserPrompt(
  donorName: string,
  linkedinData: LinkedInData | null,
  seedUrl: string | null,
  seedUrlContent: string | null,
): string {
  let prompt = `# RESEARCH BRIEF\n\n`;
  prompt += `## Donor: ${donorName}\n\n`;

  if (linkedinData) {
    prompt += `## What We Already Know\n`;
    const linkedinJson: Record<string, any> = {};
    if (linkedinData.currentTitle) linkedinJson.currentTitle = linkedinData.currentTitle;
    if (linkedinData.currentEmployer) linkedinJson.currentEmployer = linkedinData.currentEmployer;
    if (linkedinData.linkedinSlug) linkedinJson.linkedinSlug = linkedinData.linkedinSlug;
    if (linkedinData.websites?.length) linkedinJson.websites = linkedinData.websites;
    if (linkedinData.careerHistory?.length) linkedinJson.careerHistory = linkedinData.careerHistory;
    if (linkedinData.education?.length) linkedinJson.education = linkedinData.education;
    if (linkedinData.boards?.length) linkedinJson.boards = linkedinData.boards;
    prompt += JSON.stringify(linkedinJson, null, 2);
    prompt += `\n\n`;
  }

  if (seedUrl || seedUrlContent) {
    prompt += `## Seed Material\n`;
    if (seedUrl) prompt += `Source: ${seedUrl}\n\n`;
    if (seedUrlContent) prompt += seedUrlContent.slice(0, 30000) + `\n\n`;
  }

  prompt += `## Your Assignment\nResearch this person thoroughly. Find everything that helps someone prepare for a high-stakes fundraising meeting with them. Prioritize behavioral evidence — how they think, decide, and operate — over biographical facts.\n`;
  return prompt;
}

// ── Execute Deep Research (OpenAI o3-deep-research) ─────────────────

async function executeDeepResearch(
  donorName: string,
  developerMessage: string,
  userMessage: string,
  onProgress?: ProgressCallback,
  abortSignal?: AbortSignal,
  onActivity?: ActivityCallback,
): Promise<{ dossier: string; citations: DeepResearchCitation[]; searchCount: number; tokenUsage: any; durationMs: number }> {
  const emit = onProgress || (() => {});

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set. Required for deep research.');
  }

  const openai = new OpenAI({ apiKey: openaiApiKey });

  console.log(`[Stage 6] Developer message: ${developerMessage.length} chars`);
  console.log(`[Stage 6] User message: ${userMessage.length} chars`);

  // Debug save
  try {
    mkdirSync('/tmp/prospectai-outputs', { recursive: true });
    writeFileSync('/tmp/prospectai-outputs/DEBUG-deep-research-developer-msg.txt', developerMessage);
    writeFileSync('/tmp/prospectai-outputs/DEBUG-deep-research-user-msg.txt', userMessage);
  } catch (e) { /* ignore */ }

  if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');

  emit('Starting deep research (OpenAI o3-deep-research)...', 'research', 6, 38);

  const startTime = Date.now();

  // Retry helper for idempotent OpenAI calls (retrieve only)
  async function withRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
        const status = err?.status || err?.response?.status;
        if (status && status >= 400 && status < 500 && status !== 429) throw err;

        if (attempt === maxAttempts) {
          console.error(`[Stage 6] ${label} failed after ${maxAttempts} attempts:`, err?.message || err);
          throw err;
        }
        const delay = Math.min(2000 * Math.pow(2, attempt - 1), 16000);
        console.warn(`[Stage 6] ${label} attempt ${attempt} failed (${err?.message}), retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw new Error('unreachable');
  }

  // Initial request with background: true (no retry — not idempotent)
  const response = await openai.responses.create({
    model: 'o3-deep-research-2025-06-26',
    input: [
      {
        role: 'developer',
        content: [{ type: 'input_text', text: developerMessage }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: userMessage }],
      },
    ],
    tools: [{ type: 'web_search_preview' }],
    reasoning: { summary: 'detailed', effort: 'medium' },
    background: true,
    max_output_tokens: 100000,
    max_tool_calls: 20,
    store: true,
  } as any);

  // Poll every 10 seconds — abort-aware, max 45 minutes
  const MAX_POLL_DURATION_MS = 45 * 60 * 1000;
  let result: any = response;
  let lastSearchCount = 0;

  while (result.status !== 'completed' && result.status !== 'failed') {
    const elapsedMs = Date.now() - startTime;
    if (elapsedMs > MAX_POLL_DURATION_MS) {
      console.error(`[Stage 6] Polling timed out after ${Math.round(elapsedMs / 60000)} minutes`);
      throw new Error(`Deep research timed out after ${Math.round(elapsedMs / 60000)} minutes (status: ${result.status})`);
    }

    if (abortSignal?.aborted) {
      console.log(`[Stage 6] Abort detected, stopping polling`);
      throw new Error('Pipeline aborted by client');
    }

    // Abort-aware sleep
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 10000);
      if (abortSignal) {
        const onAbort = () => { clearTimeout(timer); resolve(); };
        if (abortSignal.aborted) { clearTimeout(timer); resolve(); return; }
        abortSignal.addEventListener('abort', onAbort, { once: true });
      }
    });

    if (abortSignal?.aborted) {
      throw new Error('Pipeline aborted by client');
    }

    result = await withRetry('responses.retrieve', () => openai.responses.retrieve(result.id));

    // Status extraction
    const outputItems = result.output || [];
    const searchCalls = outputItems.filter((i: any) => i.type === 'web_search_call');
    const reasoningItems = outputItems.filter((i: any) => i.type === 'reasoning');
    const codeItems = outputItems.filter((i: any) => i.type === 'code_interpreter_call');
    const messageItems = outputItems.filter((i: any) => i.type === 'message');

    const searchQueries: string[] = searchCalls
      .filter((s: any) => s.action?.type === 'search')
      .map((s: any) => s.action.query)
      .filter(Boolean);

    const pageActions = searchCalls
      .filter((s: any) => s.action?.type === 'open_page' || s.action?.type === 'find_in_page')
      .length;

    const reasoningSummaries: string[] = [];
    for (const r of reasoningItems) {
      if ((r as any).summary && Array.isArray((r as any).summary)) {
        for (const s of (r as any).summary) {
          if (s.text) reasoningSummaries.push(s.text);
        }
      }
    }

    const elapsed = Date.now() - startTime;
    const elapsedSec = Math.round(elapsed / 1000);
    const elapsedMin = Math.floor(elapsed / 60000);

    const activity: DeepResearchActivity = {
      openaiStatus: result.status,
      totalOutputItems: outputItems.length,
      searches: searchQueries.length,
      pageVisits: pageActions,
      reasoningSteps: reasoningItems.length,
      codeExecutions: codeItems.length,
      recentSearchQueries: searchQueries.slice(-5),
      reasoningSummary: reasoningSummaries.slice(-2),
      hasMessage: messageItems.length > 0,
      elapsedSeconds: elapsedSec,
    };

    if (onActivity) {
      onActivity(activity, result.id);
    }

    console.log(
      `[Stage 6] Status: ${result.status} | ` +
      `${activity.totalOutputItems} items | ` +
      `${activity.searches} searches, ${activity.pageVisits} pages, ` +
      `${activity.reasoningSteps} reasoning | ` +
      `elapsed: ${elapsedSec}s`
    );
    if (searchQueries.length > 0 && searchQueries.length !== lastSearchCount) {
      console.log(`[Stage 6] Recent queries: ${searchQueries.slice(-3).join(' | ')}`);
    }
    lastSearchCount = searchQueries.length;

    const timeLabel = elapsedMin >= 1 ? `${elapsedMin}m elapsed` : `${elapsedSec}s elapsed`;
    let progressMsg: string;
    if (result.status === 'queued') {
      progressMsg = `Deep research queued — waiting for OpenAI to start (${timeLabel})`;
    } else if (activity.searches === 0 && activity.pageVisits === 0) {
      progressMsg = `Deep research underway — processing pre-fetched sources (${timeLabel})`;
    } else {
      progressMsg = `Deep research underway — ${activity.searches} gap-fill searches, ${activity.pageVisits} pages analyzed (${timeLabel})`;
    }
    emit(progressMsg, 'research', 8, 38);
  }

  const durationMs = Date.now() - startTime;
  const durationMin = (durationMs / 60000).toFixed(1);

  if (result.status === 'failed') {
    console.error('[Stage 6] Deep research failed:', JSON.stringify(result, null, 2));
    throw new Error(`Deep research failed after ${durationMin} minutes`);
  }

  // Extract dossier
  const outputItems = result.output || [];
  const messageItems = outputItems.filter((item: any) => item.type === 'message');
  const lastMessage = messageItems[messageItems.length - 1];

  if (!lastMessage?.content?.length) {
    throw new Error('Deep research completed but returned no content');
  }

  const textContent = lastMessage.content.find((c: any) => c.type === 'output_text');
  if (!textContent) {
    throw new Error('Deep research completed but returned no text content');
  }

  const dossier = textContent.text;

  // Extract citations
  const annotations = textContent.annotations || [];
  const citations: DeepResearchCitation[] = annotations
    .filter((a: any) => a.type === 'url_citation')
    .map((a: any) => ({
      title: a.title || '',
      url: a.url || '',
      startIndex: a.start_index || 0,
      endIndex: a.end_index || 0,
    }));

  const searchCount = outputItems.filter(
    (item: any) => item.type === 'web_search_call'
  ).length;

  const tokenUsage = {
    inputTokens: result.usage?.input_tokens,
    outputTokens: result.usage?.output_tokens,
    reasoningTokens: result.usage?.output_tokens_details?.reasoning_tokens,
  };

  console.log(`[Stage 6] Complete: ${dossier.length} chars, ${searchCount} searches, ${citations.length} citations, ${durationMin} min`);
  console.log(`[Stage 6] Tokens: ${tokenUsage.inputTokens} in, ${tokenUsage.outputTokens} out, ${tokenUsage.reasoningTokens} reasoning`);

  emit(
    `Deep research complete: ${searchCount} gap-fill searches, ${Math.round(dossier.length / 4)} tokens, ${durationMin} min`,
    'research', 14, 38
  );

  // Debug saves
  try {
    mkdirSync('/tmp/prospectai-outputs', { recursive: true });
    writeFileSync('/tmp/prospectai-outputs/DEBUG-research-package.txt', dossier);
    writeFileSync('/tmp/prospectai-outputs/DEBUG-research-citations.json', JSON.stringify(citations, null, 2));
    writeFileSync('/tmp/prospectai-outputs/DEBUG-research-stats.json', JSON.stringify({
      searchCount,
      tokenUsage,
      durationMs,
      durationMin: parseFloat(durationMin),
      dossierLength: dossier.length,
      dossierTokens: Math.round(dossier.length / 4),
      citationCount: citations.length,
    }, null, 2));
  } catch (e) { /* ignore */ }

  return { dossier, citations, searchCount, tokenUsage, durationMs };
}

// ── v5 Entry Point (with pre-fetched sources) ────────────────────────

export async function runDeepResearchV5(
  donorName: string,
  linkedinData: LinkedInData | null,
  selectedSources: ScoredSource[],
  sourcesFormatted: string,
  coverageGapReport: string,
  onProgress?: ProgressCallback,
  abortSignal?: AbortSignal,
  onActivity?: ActivityCallback,
): Promise<DeepResearchResult> {
  const emit = onProgress || (() => {});

  // Build LinkedIn JSON for Section F
  const linkedinJson = linkedinData
    ? JSON.stringify({
      currentTitle: linkedinData.currentTitle,
      currentEmployer: linkedinData.currentEmployer,
      linkedinSlug: linkedinData.linkedinSlug,
      websites: linkedinData.websites,
      careerHistory: linkedinData.careerHistory,
      education: linkedinData.education,
      boards: linkedinData.boards,
    }, null, 2)
    : 'No LinkedIn data available';

  const developerMessage = buildDeveloperMessage(
    donorName,
    selectedSources.length,
    coverageGapReport,
    linkedinJson,
  );

  emit('Launching deep research with pre-fetched sources...', 'research', 2, 38);

  const { dossier, citations, searchCount, tokenUsage, durationMs } = await executeDeepResearch(
    donorName,
    developerMessage,
    sourcesFormatted,
    onProgress,
    abortSignal,
    onActivity,
  );

  // Determine evidence density
  let evidenceDensity: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';
  if (dossier.length >= 40000) evidenceDensity = 'HIGH';
  else if (dossier.length < 20000) evidenceDensity = 'LOW';

  return {
    dossier,
    citations,
    searchCount,
    tokenUsage,
    durationMs,
    researchStrategy: 'v5-bounded-synthesis',
    evidenceDensity,
  };
}

// ── Legacy Entry Point (backward compatible) ────────────────────────

export async function runDeepResearchPipeline(
  donorName: string,
  seedUrls: string[],
  linkedinData: LinkedInData | null,
  seedUrlContent: string | null,
  onProgress?: ProgressCallback,
  abortSignal?: AbortSignal,
  onActivity?: ActivityCallback,
): Promise<DeepResearchResult> {
  const emit = onProgress || (() => {});
  const seedUrl = seedUrls.length > 0 ? seedUrls[0] : null;

  // Build LinkedIn JSON for Section F
  const linkedinJson = linkedinData
    ? JSON.stringify({
      currentTitle: linkedinData.currentTitle,
      currentEmployer: linkedinData.currentEmployer,
      linkedinSlug: linkedinData.linkedinSlug,
      websites: linkedinData.websites,
      careerHistory: linkedinData.careerHistory,
      education: linkedinData.education,
      boards: linkedinData.boards,
    }, null, 2)
    : 'No LinkedIn data available';

  // In legacy mode, build a simpler developer message and user prompt
  const developerMessage = buildDeveloperMessage(
    donorName,
    0, // no pre-fetched sources
    'No coverage gap analysis available — this is a full search run.',
    linkedinJson,
  );

  const userMessage = buildLegacyUserPrompt(donorName, linkedinData, seedUrl, seedUrlContent);

  emit('Launching deep research...', 'research', 2, 38);

  const { dossier, citations, searchCount, tokenUsage, durationMs } = await executeDeepResearch(
    donorName,
    developerMessage,
    userMessage,
    onProgress,
    abortSignal,
    onActivity,
  );

  let evidenceDensity: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';
  if (dossier.length >= 40000) evidenceDensity = 'HIGH';
  else if (dossier.length < 20000) evidenceDensity = 'LOW';

  return {
    dossier,
    citations,
    searchCount,
    tokenUsage,
    durationMs,
    researchStrategy: 'legacy-full-search',
    evidenceDensity,
  };
}

// ── Quality Validation ──────────────────────────────────────────────

export function validateResearchPackage(
  dossier: string,
  numSourcesProvided: number,
): Record<string, any> {
  const checks: Record<string, any> = {};

  // Length check
  checks.length = dossier.length;
  checks.lengthPass = dossier.length >= 25000;

  // Source citation coverage
  const urlsCited = new Set(dossier.match(/https?:\/\/[^\s\)\"]+/g) || []);
  checks.uniqueSourcesCited = urlsCited.size;
  checks.sourcesExpected = numSourcesProvided;
  checks.sourceCoveragePass = urlsCited.size >= numSourcesProvided * 0.8;

  // Uncited report
  checks.hasUncitedReport = dossier.includes('SOURCES NOT CITED') || (dossier.includes('All') && dossier.includes('sources cited'));

  // Dimension coverage
  const highTierDims = ['DECISION_MAKING', 'TRUST_CALIBRATION', 'COMMUNICATION_STYLE',
    'IDENTITY_SELF_CONCEPT', 'VALUES_HIERARCHY', 'CONTRADICTION_PATTERNS', 'POWER_ANALYSIS'];
  checks.highTierCoverage = highTierDims.every(d => (dossier.match(new RegExp(d, 'g')) || []).length >= 3);

  // Zero-coverage dimensions
  checks.zeroCoverageDims = DIMENSIONS.map(d => d.key).filter(d => !dossier.includes(d));

  // Pattern flag checks
  checks.crossSourcePatterns = (dossier.match(/CROSS-SOURCE PATTERN/g) || []).length;
  checks.contradictionsFlagged = (dossier.match(/CONTRADICTION:/g) || []).length;
  checks.conditionalsFlagged = (dossier.match(/CONDITIONAL:/g) || []).length;
  checks.totalPatternFlags = checks.crossSourcePatterns + checks.contradictionsFlagged + checks.conditionalsFlagged;
  checks.patternFlagsPass = checks.totalPatternFlags >= 3;

  // Institutional inference usage
  checks.institutionalInferences = (dossier.match(/institutional_inference/g) || []).length;

  return checks;
}
