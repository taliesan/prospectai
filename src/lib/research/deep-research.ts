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

// ── Hard Time Cap ────────────────────────────────────────────────
const HARD_TIME_CAP_MS = 15 * 60 * 1000; // 15 minutes

/** Wraps an async iterable so it stops yielding after a wall-clock deadline. */
async function* withTimeCap<T>(
  iterable: AsyncIterable<T>,
  deadlineMs: number,
): AsyncGenerator<T> {
  const iterator = (iterable as any)[Symbol.asyncIterator]();
  try {
    while (true) {
      const remaining = deadlineMs - Date.now();
      if (remaining <= 0) return;
      const nextPromise = iterator.next();
      const result = await Promise.race([
        nextPromise,
        new Promise<'TIMECAP'>(resolve => setTimeout(() => resolve('TIMECAP'), remaining)),
      ]);
      if (result === 'TIMECAP') {
        nextPromise.catch(() => {}); // prevent unhandled rejection
        return;
      }
      if ((result as IteratorResult<T>).done) return;
      yield (result as IteratorResult<T>).value;
    }
  } finally {
    try { iterator.return?.(); } catch { /* ignore */ }
  }
}

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
- Editorializing about the subject's character, personality, or motivations in academic language ("suggests a pattern of," "indicates a relationship style rooted in," "implies a tendency toward," "this reveals an underlying preference for," "consistent with a personality that"). These phrases signal the wrong output register. Your commentary should describe observable behavior and its implications for someone in the room with the subject — not psychological interpretation.

ANALYTICAL REGISTER: When you write commentary after quotes or in pattern flags, write what the behavior looks like in the room and what it means for someone sitting across the table. Do not write personality descriptions or academic behavioral analysis.

Wrong register: "She frequently acknowledges others' contributions, indicating a relationship style rooted in loyalty and collaborative values. She likely engenders strong loyalty in return."

Right register: "She names her collaborators before she names her results — every time, in every interview. When someone in the room takes credit for shared work, watch for her to go quiet. That quiet isn't agreement. When someone names their team unprompted, she leans in. That's the trust signal."

Wrong register: "His grant-making history suggests he calibrates trust through incremental commitment, beginning with small exploratory gifts before scaling to major institutional support."

Right register: "He gave $25K, then $100K, then $1.2M to the same org over four years. He doesn't decide once — he decides in stages, and each stage is a test. If you ask for the big number first, you've skipped the audition he needs to see."

Wrong register: "Her public statements reveal a communication style characterized by directness and analytical rigor, suggesting she values substantive discourse over diplomatic framing."

Right register: "She told a panel audience 'that's a bad question' and then answered the question she thought they should have asked. If you soften your language around her, she reads it as evasion. Say the hard thing plainly — she'll respect the nerve even if she disagrees with the conclusion."

Wrong register: "He appears to manage tensions between his stated commitment to equity and his institutional position, suggesting an internal conflict between idealism and pragmatism."

Right register: "He writes about dismantling gatekeeping from inside the biggest gate in the field. He knows the contradiction. If you pretend it isn't there, he'll be polite and not return your call. If you name it directly — 'you're the establishment figure funding anti-establishment work, how do you think about that?' — he'll talk for twenty minutes. The contradiction is the door, not the obstacle."

Wrong register: "Interview footage suggests she processes information through questioning rather than declarative engagement, indicating a Socratic learning orientation."

Right register: "She asks three questions before she makes a single statement. The questions aren't curiosity — they're load tests. She's mapping whether your answers hold weight before she puts anything of her own on the table. If she stops asking and starts telling, she's decided you're worth building with."

Your commentary should answer: "What does this person do, when do they do it, what does it look like, and what should someone across the table do about it?" Not: "What does this behavior suggest about the subject's inner life?"

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
- For each dimension, use this two-block structure:

  QUOTES:
  [All extracted quotes for this dimension, each tagged with source type and URL. No commentary between quotes. Just the quotes, one after another, strongest first.]

  ANALYSIS:
  [Your CROSS-SOURCE PATTERN, CONTRADICTION, and CONDITIONAL flags for this dimension. This is where ALL of your analytical work goes — not between individual quotes. Write in the behavioral register described above: what the person does, when they do it, what it looks like, and what someone across the table should do about it.]

  This separation is mandatory. Do not insert interpretive commentary between quotes in the QUOTES block. The downstream profiler needs to read the subject's own words without your framing layered on top. Your analytical work is valuable — it goes in the ANALYSIS block where the profiler can read it as a separate input.

- The QUOTES block for each dimension should be substantially longer than the ANALYSIS block. Aim for at least a 3:1 ratio of quote content to analysis content. If your ANALYSIS block for a dimension is longer than your QUOTES block, you are over-interpreting and under-extracting. Go back to the sources and pull more quotes.
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
- CRITICAL: If gap-fill searches return nothing useful for a dimension, write exactly "NO EVIDENCE FOUND — [dimension name]" and move on. Do not infer, speculate, or extrapolate from the career history or LinkedIn data provided in this prompt — that data is already available to later pipeline stages. A one-line "no evidence" entry is more valuable than three paragraphs of inference.

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

// ── Execute Deep Research (OpenAI o3-deep-research) ─────────────────

export async function executeDeepResearch(
  donorName: string,
  developerMessage: string,
  userMessage: string,
  onProgress?: ProgressCallback,
  abortSignal?: AbortSignal,
  onActivity?: ActivityCallback,
  /** Max web searches. 0 = disable web_search tool entirely. Default: 20. */
  maxToolCalls?: number,
): Promise<{ dossier: string; citations: DeepResearchCitation[]; searchCount: number; tokenUsage: any; durationMs: number }> {
  const emit = onProgress || (() => {});

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    console.warn('[Deep Research] OPENAI_API_KEY not set — skipping deep research');
    emit('Deep research skipped (no API key) — continuing with pre-fetched sources', 'research', 14, 38);
    return {
      dossier: '',
      citations: [],
      searchCount: 0,
      tokenUsage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
      durationMs: 0,
    };
  }

  const openai = new OpenAI({ apiKey: openaiApiKey, timeout: 3600 * 1000 });

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
  let timeCapReached = false;

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

  // Initial request with background: true AND stream: true for live visibility.
  // background: true  — research runs async on OpenAI, survives connection drops.
  // stream: true       — SSE events show every search query, reasoning step, final report.
  // If the stream breaks, research keeps going and we fall back to polling.
  // DR requires at least one tool in the tools array — tools: [] returns a 400.
  // Always include web_search_preview; use max_tool_calls to constrain instead.
  const effectiveMaxToolCalls = maxToolCalls ?? 20;
  const tools = [{ type: 'web_search_preview' }];

  const stream = await openai.responses.create({
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
    tools,
    reasoning: { summary: 'detailed', effort: 'medium' },
    background: true,
    stream: true,
    max_output_tokens: 100000,
    max_tool_calls: effectiveMaxToolCalls,
    store: true,
  } as any);

  // ── Stream processing ──────────────────────────────────────────────
  // Log intermediate steps as they happen, accumulate the final report,
  // track the response ID so we can poll if the stream drops.
  let responseId: string | null = null;
  let result: any = null;
  let searchQueries: string[] = [];
  let reasoningSummaries: string[] = [];
  let pageVisits = 0;
  let codeExecutions = 0;
  let totalOutputItems = 0;
  let hasMessage = false;
  let reportCharsReceived = 0;
  let lastActivityUpdate = 0;

  function buildActivity(): DeepResearchActivity {
    const elapsedSec = Math.round((Date.now() - startTime) / 1000);
    return {
      openaiStatus: result?.status || 'in_progress',
      totalOutputItems,
      searches: searchQueries.length,
      pageVisits,
      reasoningSteps: reasoningSummaries.length,
      codeExecutions,
      recentSearchQueries: searchQueries.slice(-5),
      reasoningSummary: reasoningSummaries.slice(-2),
      hasMessage,
      elapsedSeconds: elapsedSec,
    };
  }

  function emitActivity() {
    const now = Date.now();
    if (now - lastActivityUpdate < 3000) return; // throttle to every 3s
    lastActivityUpdate = now;

    const activity = buildActivity();
    if (onActivity && responseId) {
      onActivity(activity, responseId);
    }

    const elapsed = Date.now() - startTime;
    const elapsedMin = Math.floor(elapsed / 60000);
    const elapsedSec = Math.round(elapsed / 1000);
    const timeLabel = elapsedMin >= 1 ? `${elapsedMin}m elapsed` : `${elapsedSec}s elapsed`;

    let progressMsg: string;
    if (activity.searches === 0 && activity.pageVisits === 0) {
      progressMsg = `Deep research underway — processing pre-fetched sources (${timeLabel})`;
    } else {
      progressMsg = `Deep research underway — ${activity.searches} gap-fill searches, ${activity.pageVisits} pages analyzed (${timeLabel})`;
    }
    emit(progressMsg, 'research', 8, 38);
  }

  try {
    for await (const event of withTimeCap(stream as unknown as AsyncIterable<any>, startTime + HARD_TIME_CAP_MS)) {
      if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');

      switch (event.type) {
        case 'response.created':
          responseId = event.response?.id;
          console.log(`[Deep Research] Response created: ${responseId} | Status: ${event.response?.status}`);
          break;

        case 'response.in_progress':
          console.log(`[Deep Research] In progress...`);
          break;

        case 'response.output_item.added':
          totalOutputItems++;
          if (event.item?.type === 'web_search_call') {
            const actionType = event.item.action?.type || 'search';
            if (actionType === 'search') {
              // Query text not reliably populated on 'added' events —
              // capture it on 'output_item.done' where it's always present.
              console.log(`[Deep Research] Search starting...`);
            } else if (actionType === 'open_page' || actionType === 'find_in_page') {
              pageVisits++;
            }
            emitActivity();
          } else if (event.item?.type === 'reasoning') {
            console.log(`[Deep Research] Reasoning block started`);
          } else if (event.item?.type === 'code_interpreter_call') {
            codeExecutions++;
          }
          break;

        case 'response.output_item.done':
          if (event.item?.type === 'web_search_call') {
            const actionType = event.item.action?.type || 'search';
            if (actionType === 'search') {
              const query = event.item.action?.query || 'unknown';
              console.log(`[Deep Research] Search done: "${query}" -> ${event.item.status}`);
              searchQueries.push(query);
            } else if (actionType === 'open_page' || actionType === 'find_in_page') {
              pageVisits++;
            }
            emitActivity();
          } else if (event.item?.type === 'reasoning') {
            for (const s of event.item.summary || []) {
              if (s.text) {
                console.log(`[Deep Research] Reasoning: ${s.text.slice(0, 200)}${s.text.length > 200 ? '...' : ''}`);
                reasoningSummaries.push(s.text);
              }
            }
            emitActivity();
          } else if (event.item?.type === 'message') {
            hasMessage = true;
          }
          break;

        case 'response.output_text.delta':
          reportCharsReceived += (event.delta || '').length;
          hasMessage = true;
          {
            const now = Date.now();
            if (now - lastActivityUpdate >= 3000) {
              lastActivityUpdate = now;
              const activity = buildActivity();
              if (onActivity && responseId) {
                onActivity(activity, responseId);
              }
              const elapsed = Date.now() - startTime;
              const elapsedMin = Math.floor(elapsed / 60000);
              const elapsedSec = Math.round(elapsed / 1000);
              const timeLabel = elapsedMin >= 1 ? `${elapsedMin}m elapsed` : `${elapsedSec}s elapsed`;
              const charsK = Math.round(reportCharsReceived / 1000);
              console.log(`[Deep Research] Writing report — ${charsK}K chars received (${timeLabel})`);
              emit(`Deep research writing report — ${charsK}K chars so far (${timeLabel})`, 'research', 10, 38);
            }
          }
          break;

        case 'response.output_text.done':
          hasMessage = true;
          console.log(`[Deep Research] Report complete (${reportCharsReceived} chars)`);
          emitActivity();
          break;

        case 'response.completed':
          result = event.response;
          console.log(`[Deep Research] Complete. ${searchQueries.length} searches, ${reasoningSummaries.length} reasoning blocks.`);
          break;

        case 'response.failed':
          result = event.response;
          console.error(`[Deep Research] Failed:`, JSON.stringify(event.response?.error || event));
          break;

        case 'response.incomplete':
          result = event.response;
          console.warn(`[Deep Research] Incomplete:`, JSON.stringify(event));
          break;
      }
    }

    // If stream ended without a response.completed event, check for time cap
    if (!result && (Date.now() - startTime) >= HARD_TIME_CAP_MS) {
      timeCapReached = true;
      const elapsedMin = ((Date.now() - startTime) / 60000).toFixed(1);
      console.warn(`[Deep Research] Hard time cap reached (15 min) during stream — will extract partial output (elapsed: ${elapsedMin} min)`);
    }
  } catch (streamError: any) {
    // Stream broke — but background=true means research continues on OpenAI's side
    console.warn(`[Deep Research] Stream interrupted: ${streamError.message}`);

    if (streamError.message === 'Pipeline aborted by client') {
      throw streamError;
    }

    if (responseId) {
      console.log(`[Deep Research] Research continues in background (${responseId}). Falling back to polling...`);

      result = await withRetry('responses.retrieve', () => openai.responses.retrieve(responseId!));

      while (result.status !== 'completed' && result.status !== 'failed') {
        const elapsedMs = Date.now() - startTime;
        if (elapsedMs > HARD_TIME_CAP_MS) {
          timeCapReached = true;
          const elapsedMin = (elapsedMs / 60000).toFixed(1);
          console.warn(`[Deep Research] Hard time cap reached (15 min) during polling — using partial output (elapsed: ${elapsedMin} min)`);
          break;
        }

        if (abortSignal?.aborted) {
          throw new Error('Pipeline aborted by client');
        }

        // Abort-aware sleep (10s)
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

        result = await withRetry('responses.retrieve', () => openai.responses.retrieve(responseId!));

        // Rebuild activity from the polled response
        const pollOutput = result.output || [];
        const pollSearches = pollOutput.filter((i: any) => i.type === 'web_search_call' && i.action?.type === 'search');
        const pollPages = pollOutput.filter((i: any) => i.type === 'web_search_call' && (i.action?.type === 'open_page' || i.action?.type === 'find_in_page'));
        const pollReasoning = pollOutput.filter((i: any) => i.type === 'reasoning');

        searchQueries = pollSearches.map((s: any) => s.action.query).filter(Boolean);
        pageVisits = pollPages.length;
        reasoningSummaries = [];
        for (const r of pollReasoning) {
          for (const s of (r as any).summary || []) {
            if (s.text) reasoningSummaries.push(s.text);
          }
        }
        totalOutputItems = pollOutput.length;
        hasMessage = pollOutput.some((i: any) => i.type === 'message');
        codeExecutions = pollOutput.filter((i: any) => i.type === 'code_interpreter_call').length;

        const activity = buildActivity();
        if (onActivity && responseId) {
          onActivity(activity, responseId);
        }

        const elapsed = Date.now() - startTime;
        const elapsedSec = Math.round(elapsed / 1000);
        const elapsedMin = Math.floor(elapsed / 60000);
        const timeLabel = elapsedMin >= 1 ? `${elapsedMin}m elapsed` : `${elapsedSec}s elapsed`;

        console.log(
          `[Deep Research] Poll elapsed: ${(elapsed / 60000).toFixed(1)} min | ` +
          `status: ${result.status} | ` +
          `${totalOutputItems} items | ` +
          `${searchQueries.length} searches, ${pageVisits} pages, ` +
          `${reasoningSummaries.length} reasoning`
        );

        let progressMsg: string;
        if (result.status === 'queued') {
          progressMsg = `Deep research queued — waiting for OpenAI to start (${timeLabel})`;
        } else if (searchQueries.length === 0 && pageVisits === 0) {
          progressMsg = `Deep research underway — processing pre-fetched sources (${timeLabel})`;
        } else {
          progressMsg = `Deep research underway — ${searchQueries.length} gap-fill searches, ${pageVisits} pages analyzed (${timeLabel})`;
        }
        emit(progressMsg, 'research', 8, 38);
      }

      // Log all recovered intermediate steps
      if (result.status === 'completed') {
        console.log(`[Deep Research] Recovered via polling after stream drop`);
        for (const item of (result.output || [])) {
          if (item.type === 'web_search_call' && item.action?.type === 'search') {
            console.log(`[Deep Research] Search (recovered): "${item.action.query}" -> ${item.status}`);
          } else if (item.type === 'reasoning') {
            for (const s of item.summary || []) {
              if (s.text) console.log(`[Deep Research] Reasoning (recovered): ${s.text.slice(0, 200)}${s.text.length > 200 ? '...' : ''}`);
            }
          }
        }
      }
    } else {
      throw new Error(`Deep research stream failed and no response ID was captured: ${streamError.message}`);
    }
  }

  // Safety: if stream completed but we missed the response.completed event, retrieve it
  if (!result && responseId) {
    console.log(`[Deep Research] Retrieving final result for ${responseId}...`);
    result = await withRetry('responses.retrieve', () => openai.responses.retrieve(responseId!));
  }

  if (!result) {
    if (timeCapReached) {
      const durationMs = Date.now() - startTime;
      console.error('[Deep Research] Hard time cap reached (15 min) — no response ID, returning empty output');
      emit('Deep research capped at 15 min — no output available', 'research', 14, 38);
      return { dossier: '', citations: [], searchCount: 0, tokenUsage: {}, durationMs };
    }
    throw new Error('Deep research completed but no result was captured');
  }

  // Final activity update
  if (onActivity && responseId) {
    const finalActivity = buildActivity();
    finalActivity.openaiStatus = result.status;
    onActivity(finalActivity, responseId);
  }

  const durationMs = Date.now() - startTime;
  const durationMin = (durationMs / 60000).toFixed(1);

  if (result.status === 'failed' && !timeCapReached) {
    // Extract error details for logging
    const errorMsg = result.error?.message || result.error?.code || 'unknown error';
    console.error('[Stage 6] Deep research failed:', JSON.stringify(result, null, 2));
    // Graceful degradation: quota/API failures should not crash the pipeline.
    // The profile can still be generated from pre-fetched sources alone.
    console.warn(`[Deep Research] Falling back to no deep research — ${errorMsg}`);
    emit(`Deep research unavailable (${errorMsg}) — continuing with pre-fetched sources`, 'research', 14, 38);

    return {
      dossier: '',
      citations: [],
      searchCount: 0,
      tokenUsage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
      durationMs: Date.now() - startTime,
    };
  }

  // Extract dossier — graceful degradation when time cap reached
  const outputItems = result.output || [];
  const messageItems = outputItems.filter((item: any) => item.type === 'message');
  const lastMessage = messageItems[messageItems.length - 1];

  let dossier: string;

  if (lastMessage?.content?.length) {
    const textContent = lastMessage.content.find((c: any) => c.type === 'output_text');
    if (textContent?.text) {
      dossier = textContent.text;
    } else if (timeCapReached) {
      console.warn('[Deep Research] Hard time cap reached (15 min) — no text in partial output, continuing without deep research');
      dossier = '';
    } else {
      throw new Error('Deep research completed but returned no text content');
    }
  } else if (timeCapReached) {
    console.warn('[Deep Research] Hard time cap reached (15 min) — no partial output available, continuing without deep research');
    dossier = '';
  } else {
    throw new Error('Deep research completed but returned no content');
  }

  // Final log line: complete or capped
  if (timeCapReached) {
    console.warn(`[Deep Research] Deep research capped at 15 min — partial output used (${dossier.length} chars)`);
  } else {
    console.log(`[Deep Research] Deep research complete: ${durationMin} min`);
  }

  // Extract citations
  const textContentForCitations = lastMessage?.content?.find((c: any) => c.type === 'output_text');
  const annotations = textContentForCitations?.annotations || [];
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

// runDeepResearchPipeline() archived to _archived/deep-research-legacy.ts

// ── Gap-Fill Message Builders (v6 Pipeline) ─────────────────────────
//
// DR receives NO raw source text. It receives only the gap report,
// LinkedIn career history, and instructions to search the web for
// evidence on thin dimensions. The pre-fetched sources go to Opus.

export function buildGapFillDeveloperMessage(
  subjectName: string,
  coverageGapReport: string,
  linkedinJson: string,
): string {
  return `You are a behavioral research analyst performing gap-fill research on ${subjectName}.

Pre-research has already scored and selected sources covering most behavioral dimensions. Your job is to find what the initial search missed — sources that Tavily didn't surface, pages that weren't in the initial query set, content that fills the specific gaps below.

CURRENT COVERAGE STATUS:
${coverageGapReport}

YOUR INSTRUCTIONS:
1. Review the coverage map. Focus on dimensions with ZERO_COVERAGE, CRITICAL_GAP, or THIN strength.
2. Conduct targeted web searches for those gaps (max 15-20 searches).
3. Read what you find carefully. Extract specific behavioral evidence — quotes, described actions, observed patterns — not biographical summaries.
4. Write up your findings organized by dimension. For each dimension you find new evidence for:
   - Quote the relevant passages (50-300 words each)
   - Note the source URL
   - Write a brief analysis of what the evidence reveals about behavior
5. CRITICAL: If a search returns nothing useful for a dimension, write exactly "NO EVIDENCE FOUND — [dimension name]" and move to the next dimension. Do not infer, speculate, or extrapolate from the career history or LinkedIn data provided in this prompt — that data is already available to later pipeline stages. A one-line "no evidence" entry is more valuable than three paragraphs of inference. Your job is to surface NEW sources not already in the pre-research package. If a dimension has zero new sources after your searches, say so in one line and move on. The profile generation stage handles thin-evidence dimensions — compensating for their absence is not your responsibility and degrades output quality.
6. Do NOT search for dimensions already at STRONG coverage unless you spot a contradiction.

ANALYTICAL REGISTER: Write what the behavior looks like in the room. Not personality descriptions. What someone across the table would see, and what they should do about it.

BEHAVIORAL DIMENSIONS:
${formatDimensionsForPrompt()}

CAREER HISTORY (use for search targeting):
${linkedinJson}`;
}

export function buildGapFillUserMessage(
  subjectName: string,
  currentTitle: string,
  currentEmployer: string,
): string {
  return `Target: ${subjectName}
Current title: ${currentTitle} at ${currentEmployer}

Find behavioral evidence for the underserved dimensions listed in the coverage status above. Focus your searches on:
- Interview transcripts, podcast appearances, panel discussions
- Conference talks or presentations
- Long-form writing not on their known personal domains
- Third-party profiles or features
- Organizational documents from their tenure at key employers

Prioritize sources where the target reveals HOW they think, not just WHAT they've done.`;
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

  // v2 structural checks
  checks.crossSourcePatterns = (dossier.match(/CROSS-SOURCE PATTERN:/g) || []).length;
  checks.conditionals = (dossier.match(/CONDITIONAL:/g) || []).length;

  // Attribution tag counts
  checks.targetAuthored = (dossier.match(/target_authored/g) || []).length;
  checks.targetCoverage = (dossier.match(/target_coverage/g) || []).length;
  checks.institutionalInference = (dossier.match(/institutional_inference/g) || []).length;
  checks.attributionTags = checks.targetAuthored + checks.targetCoverage + checks.institutionalInference;

  // Synthesis flags
  const flagMatches = dossier.match(/### Flag \d+:/g) || [];
  checks.synthesisFlags = flagMatches.length;

  // Source coverage audit
  checks.hasCoverageAudit = dossier.includes('## SOURCE COVERAGE AUDIT');

  return checks;
}
