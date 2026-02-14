// Deep Research Integration — OpenAI o3-deep-research
//
// Sends a focused behavioral-profiling prompt directly to o3-deep-research.
// No intermediate Sonnet strategy call — the model decides its own search strategy.
//
// Controlled by RESEARCH_PROVIDER env var:
//   RESEARCH_PROVIDER=openai     → this module (default)
//   RESEARCH_PROVIDER=anthropic  → fallback to Tavily pipeline

import OpenAI from 'openai';
import { LinkedInData } from '../prompts/extraction-prompt';
import { writeFileSync, mkdirSync } from 'fs';
import type { DeepResearchActivity, ActivityCallback } from '../job-store';

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
}

export interface DeepResearchCitation {
  title: string;
  url: string;
  startIndex: number;
  endIndex: number;
}

type ProgressCallback = (message: string, phase?: string, step?: number, totalSteps?: number) => void;

// ── Deep Research Developer Prompt ────────────────────────────────

const DEEP_RESEARCH_DEVELOPER_PROMPT = `You are the best psychographic profiler working in fundraising today. You don't write biographies. You don't summarize careers. You build behavioral maps of how a specific person thinks, decides, commits, retreats, and responds under pressure.

You're not fooled by public personas. You look past what people say about themselves to find the patterns in what they actually do — the contradictions between their stated values and their revealed behavior, the gaps between how they present and how they operate, the moments where their guard drops and you can see the real decision architecture underneath.

## WHAT THIS IS FOR

Someone is walking into a high-stakes fundraising meeting with this person in 12 hours. They need to know:
- What moves this person from evaluation to engagement
- What shuts them down instantly
- How they build trust and how trust breaks
- How they make funding decisions — what has to be present, what permission they give themselves, what the commitment looks like when it arrives
- What contradictions in their worldview create openings
- How they communicate and what register they expect
- What they'll risk and what they won't

This is not a research report. It's a tactical instrument. Every fact you find earns its place only if it changes what the reader does in the meeting.

## WHAT TO LOOK FOR

Search for evidence across these 24 behavioral categories. Not all will have evidence. That's fine — report what you find and flag what's missing.

1. DECISION_MAKING — How they choose. What has to be present for a yes. What sequence they follow.
2. TRUST_CALIBRATION — How trust builds, what tests it, what breaks it. Past betrayals that rewired their filters.
3. INFLUENCE_SUSCEPTIBILITY — Who moves them. What kind of authority or experience earns their attention.
4. COMMUNICATION_STYLE — How they talk and write. What register they use. When the tone shifts and what the shift signals.
5. SELF_CONCEPT — Who they think they are. The identity they need to maintain. What it permits and prevents.
6. VALUE_HIERARCHY — What they believe matters most. Their diagnosis of what's broken and what fixes it.
7. CONTRADICTION_ARCHITECTURE — Where their stated values and actual behavior diverge. Not hypocrisy — structural tensions they live inside.
8. RELATIONSHIP_FORMATION — How they build relationships. What sustains them. What ends them.
9. COMMITMENT_PATTERNS — How long they stay. What holds them. What breaks their commitment.
10. RISK_ARCHITECTURE — What they'll absorb and what they won't. What the pattern reveals about their operating model.
11. RESOURCE_PHILOSOPHY — How they think about money. What they believe it can and can't do. How they deploy it.
12. STATUS_DYNAMICS — What recognition they accept, what they deflect. How they position themselves relative to power.
13. LEARNING_ARCHITECTURE — How they take in new information. Experiential vs. analytical. What formats earn their attention.
14. DOMAIN_EXPERTISE — Where they have real command, working familiarity, or are shallow. What to explain and what to assume.
15. INSTITUTIONAL_POSTURE — How they relate to organizations. Builder, reformer, critic, outsider. What institutional roles they accept and reject.
16. POWER_ANALYSIS — How they understand and talk about power. Structural vs. personal. What vocabulary they use.
17. EMOTIONAL_TRIGGERS — What activates them emotionally. Anger, delight, moral outrage. What the triggers reveal about core commitments.
18. RETREAT_PATTERNS — When they withdraw, what triggers it, what it looks like, how they come back.
19. SHAME_DEFENSE_TRIGGERS — What they can't tolerate being seen as. What accusations would be most destabilizing.
20. REAL_TIME_INTERPERSONAL_TELLS — Observable behavioral signals in interactions. How they signal interest, disengagement, or shift.
21. TEMPO_MANAGEMENT — How they move through time. Fast vs. slow in different contexts. What the variation reveals.
22. HIDDEN_FRAGILITIES — Anxieties, insecurities, or vulnerabilities they don't advertise but that leak through their choices.
23. RECOVERY_PATHS — How they come back from setbacks, failed projects, broken relationships. What the recovery pattern reveals.
24. CONDITIONAL_BEHAVIORAL_FORKS — Where the same person behaves completely differently depending on context. The fork conditions and what they mean.

## EVIDENCE STANDARDS

- Preserve exact quotes. Long ones — 50 to 200 words. The person's actual language is the evidence. Do not paraphrase.
- Cite everything. URL, publication, date.
- Find their own voice first: blog posts, newsletters, podcast appearances, interviews, conference talks, op-eds, social media. What they write and say unprompted reveals more than what others write about them.
- Then find third-party coverage: press, profiles, organizational bios, event descriptions.
- Look across their full career, not just the current role.
- If you're unsure whether two search results refer to the same person, flag it. Don't merge ambiguous identities.

## WHAT NOT TO DO

- Do not analyze or interpret. Do not write "This shows he values X" or "This suggests she believes Y." Present the evidence and its context. The reader draws the conclusions.
- Do not include trivia — food preferences, pets, workout routines, sports teams — unless it directly signals identity, worldview, status, or network access.
- Do not summarize when you can quote. The exact words matter.`;

// ── Build User Prompt (per-donor) ─────────────────────────────────

function buildDeepResearchUserPrompt(
  donorName: string,
  linkedinData: LinkedInData | null,
  seedUrl: string | null,
  seedUrlContent: string | null,
): string {
  let prompt = `# RESEARCH BRIEF\n\n`;

  // Donor identity
  prompt += `## Donor: ${donorName}\n\n`;

  // Context
  prompt += `## Context\n`;
  prompt += `Organization: Democracy Takes Work (DTW)\n`;
  prompt += `Mission: Supporting workplace organization movements\n`;
  prompt += `Meeting type: Donor cultivation / major gift prospect\n`;
  prompt += `What we need: How this person decides to fund, what moves them, what shuts them down, how to build trust, what risks exist.\n\n`;

  // LinkedIn data as "What We Already Know"
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

  // Seed material
  if (seedUrl || seedUrlContent) {
    prompt += `## Seed Material\n`;
    prompt += `The following is from their personal website/bio. Use it to identify their voice, frameworks, key relationships, and topics worth searching deeper on.\n\n`;
    if (seedUrl) {
      prompt += `Source: ${seedUrl}\n\n`;
    }
    if (seedUrlContent) {
      prompt += seedUrlContent.slice(0, 30000);
      prompt += `\n\n`;
    }
  }

  // Assignment
  prompt += `## Your Assignment\n`;
  prompt += `Research this person thoroughly. Find everything that helps someone prepare for a high-stakes fundraising meeting with them. Prioritize behavioral evidence — how they think, decide, and operate — over biographical facts.\n`;

  return prompt;
}

// ── Execute Deep Research (OpenAI o3-deep-research) ───────────────

async function executeDeepResearch(
  donorName: string,
  linkedinData: LinkedInData | null,
  seedUrl: string | null,
  seedUrlContent: string | null,
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

  const userPrompt = buildDeepResearchUserPrompt(
    donorName,
    linkedinData,
    seedUrl,
    seedUrlContent,
  );

  console.log(`[DeepResearch] User prompt: ${userPrompt.length} chars`);

  // Debug save
  try {
    mkdirSync('/tmp/prospectai-outputs', { recursive: true });
    writeFileSync('/tmp/prospectai-outputs/DEBUG-deep-research-user-prompt.txt', userPrompt);
  } catch (e) { /* ignore */ }

  if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');

  emit('Starting deep research (OpenAI o3-deep-research)...', 'research', 6, 38);

  const startTime = Date.now();

  // Retry helper for idempotent OpenAI calls (retrieve only — never create)
  async function withRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        // Don't retry abort
        if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
        // Don't retry 4xx errors (except 429 rate limit)
        const status = err?.status || err?.response?.status;
        if (status && status >= 400 && status < 500 && status !== 429) throw err;

        if (attempt === maxAttempts) {
          console.error(`[DeepResearch] ${label} failed after ${maxAttempts} attempts:`, err?.message || err);
          throw err;
        }
        const delay = Math.min(2000 * Math.pow(2, attempt - 1), 16000);
        console.warn(`[DeepResearch] ${label} attempt ${attempt} failed (${err?.message}), retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw new Error('unreachable');
  }

  // Initial request with background: true — NO retry (not idempotent; retry would launch a second job)
  const response = await openai.responses.create({
    model: 'o3-deep-research-2025-06-26',
    input: [
      {
        role: 'developer',
        content: [{ type: 'input_text', text: DEEP_RESEARCH_DEVELOPER_PROMPT }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: userPrompt }],
      },
    ],
    tools: [{ type: 'web_search_preview' }],
    reasoning: { effort: 'high' },
    background: true,
    store: true,
  } as any);

  // Poll every 10 seconds — abort-aware, max 30 minutes
  const MAX_POLL_DURATION_MS = 60 * 60 * 1000; // 60 minutes
  let result: any = response;
  let lastSearchCount = 0;

  while (result.status !== 'completed' && result.status !== 'failed') {
    // Guard against infinite polling
    const elapsedMs = Date.now() - startTime;
    if (elapsedMs > MAX_POLL_DURATION_MS) {
      console.error(`[DeepResearch] Polling timed out after ${Math.round(elapsedMs / 60000)} minutes for response ${result.id}`);
      throw new Error(`Deep research timed out after ${Math.round(elapsedMs / 60000)} minutes (status: ${result.status})`);
    }
    // Check abort before sleeping
    if (abortSignal?.aborted) {
      console.log(`[DeepResearch] Abort detected, stopping polling for response ${result.id}`);
      throw new Error('Pipeline aborted by client');
    }

    // Abort-aware sleep: resolves after 10s OR when abort fires, whichever is first
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 10000);
      if (abortSignal) {
        const onAbort = () => { clearTimeout(timer); resolve(); };
        if (abortSignal.aborted) { clearTimeout(timer); resolve(); return; }
        abortSignal.addEventListener('abort', onAbort, { once: true });
      }
    });

    // Check abort after waking
    if (abortSignal?.aborted) {
      console.log(`[DeepResearch] Abort detected after sleep, stopping polling for response ${result.id}`);
      throw new Error('Pipeline aborted by client');
    }

    result = await withRetry('responses.retrieve', () => openai.responses.retrieve(result.id));

    // ── Deep status extraction from the output array ──────────────
    const outputItems = result.output || [];

    const searchCalls = outputItems.filter((i: any) => i.type === 'web_search_call');
    const reasoningItems = outputItems.filter((i: any) => i.type === 'reasoning');
    const codeItems = outputItems.filter((i: any) => i.type === 'code_interpreter_call');
    const messageItems = outputItems.filter((i: any) => i.type === 'message');

    // Extract search queries (action.type === 'search' has .action.query)
    const searchQueries: string[] = searchCalls
      .filter((s: any) => s.action?.type === 'search')
      .map((s: any) => s.action.query)
      .filter(Boolean);

    // Count page opens/finds
    const pageActions = searchCalls
      .filter((s: any) => s.action?.type === 'open_page' || s.action?.type === 'find_in_page')
      .length;

    // Extract reasoning summaries
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

    // Build activity snapshot
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

    // Report activity to job store
    if (onActivity) {
      onActivity(activity, result.id);
    }

    // ── Rich diagnostic logging ───────────────────────────────────
    console.log(
      `[DeepResearch] Status: ${result.status} | ` +
      `${activity.totalOutputItems} items | ` +
      `${activity.searches} searches, ${activity.pageVisits} pages, ` +
      `${activity.reasoningSteps} reasoning | ` +
      `elapsed: ${elapsedSec}s`
    );
    if (searchQueries.length > 0 && searchQueries.length !== lastSearchCount) {
      console.log(`[DeepResearch] Recent queries: ${searchQueries.slice(-3).join(' | ')}`);
    }
    lastSearchCount = searchQueries.length;

    // ── User-facing progress message ──────────────────────────────
    const timeLabel = elapsedMin >= 1 ? `${elapsedMin}m elapsed` : `${elapsedSec}s elapsed`;
    let progressMsg: string;
    if (result.status === 'queued') {
      progressMsg = `Deep research queued — waiting for OpenAI to start (${timeLabel})`;
    } else if (activity.searches === 0 && activity.pageVisits === 0) {
      progressMsg = `Deep research underway — planning research approach (${timeLabel})`;
    } else {
      progressMsg = `Deep research underway — ${activity.searches} searches, ${activity.pageVisits} pages analyzed (${timeLabel})`;
    }

    emit(progressMsg, 'research', 8, 38);
  }

  const durationMs = Date.now() - startTime;
  const durationMin = (durationMs / 60000).toFixed(1);

  if (result.status === 'failed') {
    console.error('[DeepResearch] Deep research failed:', JSON.stringify(result, null, 2));
    throw new Error(`Deep research failed after ${durationMin} minutes`);
  }

  // Extract dossier from final output
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

  // Count total searches
  const searchCount = outputItems.filter(
    (item: any) => item.type === 'web_search_call'
  ).length;

  // Token usage
  const tokenUsage = {
    inputTokens: result.usage?.input_tokens,
    outputTokens: result.usage?.output_tokens,
    reasoningTokens: result.usage?.output_tokens_details?.reasoning_tokens,
  };

  console.log(`[DeepResearch] Complete: ${dossier.length} chars, ${searchCount} searches, ${citations.length} citations, ${durationMin} min`);
  console.log(`[DeepResearch] Tokens: ${tokenUsage.inputTokens} in, ${tokenUsage.outputTokens} out, ${tokenUsage.reasoningTokens} reasoning`);

  emit(
    `Deep research complete: ${searchCount} searches, ${Math.round(dossier.length / 4)} tokens, ${durationMin} min`,
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

// ── Main Entry Point ──────────────────────────────────────────────

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

  // Determine seed URL (use first one if multiple)
  const seedUrl = seedUrls.length > 0 ? seedUrls[0] : null;

  // Launch deep research directly (no Sonnet strategy phase)
  emit('Launching deep research...', 'research', 2, 38);

  const { dossier, citations, searchCount, tokenUsage, durationMs } = await executeDeepResearch(
    donorName,
    linkedinData,
    seedUrl,
    seedUrlContent,
    onProgress,
    abortSignal,
    onActivity,
  );

  return {
    dossier,
    citations,
    searchCount,
    tokenUsage,
    durationMs,
    researchStrategy: '',
  };
}
