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

const DEEP_RESEARCH_DEVELOPER_PROMPT = `You are a research investigator preparing a dossier for a psychographic profiler. Your job is to find the richest possible behavioral evidence about this person — everything the profiler needs to do a thorough job. The profiler works downstream. They will do the analysis, draw the conclusions, and write the final document. Your job is evidence.

You are not writing a profile. You are not organizing evidence into categories. You are hunting for sources where this person reveals how they actually think, decide, commit, retreat, and operate under pressure.

IMPORTANT OUTPUT INSTRUCTION: You must report ALL behavioral evidence you find, without summarizing, condensing, or omitting any usable material discovered in your searches. Do NOT stop early or limit the number of citations arbitrarily. If you find 70 sources with relevant quotes, report evidence from all 70 sources, as long as it fits the source and evidence standards below. Do NOT truncate your output. Fully report every extractable piece of relevant behavioral evidence you discover. Your output should be 30,000–60,000 characters. Use that space for the richest behavioral evidence you found across the broadest range of sources.

## WHAT YOU ALREADY HAVE

The research brief below contains a LinkedIn profile and seed material from a URL associated with the subject. The profiler will also have this material. You may quote from it — but your job is to go far beyond it. If your final output only contains evidence from the LinkedIn and seed URL, you haven't done your job.

Use the seed material to identify names, organizations, campaigns, events, and affiliations worth searching. Then go find everything else.

## WHAT GOOD SOURCES LOOK LIKE

These tiers indicate value, not gates. If a person has no Tier 1 evidence, go deep on Tier 2, 3, and 4. A rich dossier from lower tiers is far better than a thin one that only looked for podcasts.

Tier 1 — Their voice in contexts they don't control: Podcast interviews, conference panel recordings/transcripts, press quotes attributed to them, legislative or board testimony, recorded talks, webinar appearances, AMA threads. Highest value because the subject speaks in their own words but can't fully curate the context.

Tier 2 — Observed behavior reported by others: Journalist profiles, organizational case studies that name them, press coverage of campaigns or deals they led, colleague or partner testimonials in published interviews, award citations with specific behavioral descriptions.

Tier 3 — Their voice in contexts they control: Blog posts, newsletter archives, op-eds, social media threads, LinkedIn posts, published essays, book chapters, personal website pages beyond the seed URL. A subject who writes extensively about their own decisions, values, and worldview is giving you a wealth of behavioral evidence. Find and quote from every page you can. Each distinct URL counts as one source — multiple posts on the same blog are multiple sources.

Tier 4 — Structural, financial, and institutional records: Foundation grant databases (990s), org charts, board minutes, public filings, event programs listing their role, conference agendas, institutional annual reports. These reveal what they actually did versus what they say they did. When the subject isn't named directly, the institution's behavior during their tenure is partial evidence of how they operate — if the org made a major strategic shift while they were VP, that's usable. Flag it as institutional rather than personal evidence.

## WHAT TO LOOK FOR

The profiler needs behavioral evidence — how this person actually operates, not biographical facts. Search for evidence that illuminates:

1. DECISION_MAKING — How they choose. What has to be present for a yes.
2. TRUST_CALIBRATION — How trust builds, what tests it, what breaks it.
3. INFLUENCE_SUSCEPTIBILITY — Who moves them. What authority earns their attention.
4. COMMUNICATION_STYLE — How they talk in different contexts. Register shifts.
5. SELF_CONCEPT — Who they think they are. The identity they protect.
6. VALUE_HIERARCHY — What they believe matters most. Their diagnosis of what's broken.
7. CONTRADICTION_ARCHITECTURE — Where stated values and actual behavior diverge.
8. COMMITMENT_PATTERNS — How long they stay. What holds them. What breaks commitment.
9. RISK_ARCHITECTURE — What they'll absorb and what they won't.
10. RESOURCE_PHILOSOPHY — How they think about money and deploy it.
11. STATUS_DYNAMICS — What recognition they accept or deflect.
12. INSTITUTIONAL_POSTURE — Builder, reformer, critic, outsider.
13. POWER_ANALYSIS — How they understand and talk about power.
14. EMOTIONAL_TRIGGERS — What activates them. Anger, delight, moral outrage.
15. NETWORK_MAP — Who they work with, defer to, promote, avoid. Named relationships with observable dynamics.
16. CONTROVERSY_AND_PRESSURE — Moments where values were tested externally. How they responded.

Not all will have evidence. Report what you find and flag what's missing. An honest "no evidence found" is more valuable than padding.

## NETWORKS AND AFFILIATIONS

Search for the subject's network — not just their job history. Look for:
- Board memberships, advisory roles, committee seats
- Co-authors, co-signers, coalition partners
- Foundation relationships (as grantee, grantor, advisor, or board member)
- Organizational affiliations beyond employment (membership orgs, working groups, campaigns)
- Named relationships in press coverage, event programs, or institutional publications

People reveal how they operate through who they choose to work with and who chooses them.

## SEARCH EFFORT

Aim for breadth across multiple domains and source types. Each distinct URL with distinct content counts as one source. Multiple blog posts on the same site are multiple sources — go deep when the writing is rich.

When to stop searching: when new searches return pages you've already seen, or when you've covered at least 4 career phases and 3 source types. Do not keep searching past the point of diminishing returns. Do NOT stop output or reporting early — report every instance of usable evidence found.

## EVIDENCE STANDARDS

- Preserve exact quotes. Long ones — 50 to 200 words. The person's actual language is the evidence.
- Cite everything. URL, publication, date.
- For each quote or finding, add one line flagging why it matters behaviorally. One sentence only — the profiler draws deeper conclusions.
- If you're unsure whether two search results refer to the same person, flag it. Don't merge ambiguous identities.
- If you find 30 relevant sources, report evidence from all 30; if you find 100, report evidence from all 100.

## WHAT NOT TO DO

- Do not rely solely on the LinkedIn and seed URL provided in the brief. They are your starting point, not your finish line.
- Do not write a profile, analysis, or organized report. The profiler has tools and frameworks for that. Your job is evidence.
- Do not include trivia unless it directly signals identity or network access.
- Do not pad. If you found 12 good sources, report 12. Don't stretch thin findings across 40,000 tokens of filler.
- Do NOT truncate your output or omit any discovered behavioral evidence. Fully report ALL evidence discovered in your searches.

## OUTPUT FORMAT

Organize by source, not by category. For each source found:

[Source title] — [URL] — [Date if known]
[Exact quotes, 50-200 words each]
[One-line behavioral flag for each quote]
[Which of the 16 categories above this evidence serves]

At the end, include:
- Sources searched but empty: URLs checked that had nothing useful
- Categories with no evidence: Which of the 16 had no findings
- Suggested follow-up searches: Queries that might yield results with more time`;

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
    reasoning: { effort: 'medium' },
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
