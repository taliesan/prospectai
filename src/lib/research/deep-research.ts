// Deep Research Integration — OpenAI o3-deep-research
//
// Replaces the Tavily/screening/tiering/extraction chain with:
//   1 Sonnet call (research strategy) + 1 OpenAI deep research call (dossier)
//
// Controlled by RESEARCH_PROVIDER env var:
//   RESEARCH_PROVIDER=openai     → this module (default)
//   RESEARCH_PROVIDER=anthropic  → fallback to Tavily pipeline

import OpenAI from 'openai';
import { complete } from '../anthropic';
import { LinkedInData } from '../prompts/extraction-prompt';
import { writeFileSync, mkdirSync } from 'fs';

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

// ── Research Strategy Prompt (Sonnet) ─────────────────────────────

const RESEARCH_STRATEGY_SYSTEM = 'You are a research strategist preparing a briefing for a deep research agent.';

function buildResearchStrategyPrompt(
  donorName: string,
  linkedinData: LinkedInData | null,
  seedUrl: string | null,
  seedUrlContent: string | null,
): string {
  let prompt = `You are a research strategist preparing a briefing for a deep research agent. The agent will use your strategy to conduct an exhaustive web search about a donor prospect.

You will receive:
- The donor's name
- Their LinkedIn profile data (if available)
- Content from their personal website or seed URL (if available)
- Context about the organization seeking the meeting

Your job is to produce a RESEARCH STRATEGY with four sections:

A) IDENTITY RESOLUTION
Produce an identity block with:
- Full name + common variants or misspellings
- Known locations (city/state/country)
- Current + recent employers with dates
- Known associates and organizations
- Personal websites and publishing platforms found in the LinkedIn data or seed URL
- Disambiguation notes: are there other people with this name who might contaminate search results? What distinguishes this person from them?

B) COVERAGE MAP
Produce a checklist of research categories. For each category:
- What "done" looks like (specific types of sources)
- Minimum source count target
- Priority domains or databases to search
- What a gap in this category would mean for the dossier

Categories: Primary voice, Professional coverage, Philanthropic/financial, Network/relationships, Controversy/criticism, Recent activity.

C) QUERY EXPANSION SET
Generate 30-80 specific search queries organized by type:
- Tight queries (exact name + specific employer/org/initiative)
- Wide queries (topic adjacency, interviews, podcasts)
- Negative queries (controversy, lawsuits, criticism)
- Relationship queries (boards, co-founders, collaborators)
- Platform-specific queries (LinkedIn, Substack, personal site)

Be SPECIFIC. Use the donor's actual employers, initiatives, frameworks, and publications BY NAME. Pull these from the LinkedIn data and seed URL content.

Good: "Geoffrey MacDougall" "Minimum Viable Partnerships"
Good: site:intangible.ca "theory of power"
Bad: "Geoffrey MacDougall" career history
Bad: "Geoffrey MacDougall" biography

Each query should note what category it serves and any exclusion terms needed to avoid same-name contamination.

D) STOPPING RULES + QA RUBRIC
Define:
- When to stop searching (repetition threshold)
- How to detect irrelevant surface area (the relevance filter)
- How to confirm identity matches
- How to grade completeness per category

Output all four sections as structured text. This output will be pasted directly into a deep research prompt, so make it clean, specific, and machine-usable.

---

# DONOR: ${donorName}

## CAMPAIGN CONTEXT
Organization: Democracy Takes Work (DTW)
Mission: Supporting workplace organization movements
Meeting type: Donor cultivation / major gift prospect
What we need: How this person decides to fund, what moves them, what sets them off, how to build trust, what risks exist.

`;

  if (linkedinData) {
    prompt += `## LINKEDIN PROFILE DATA
Current role: ${linkedinData.currentTitle} at ${linkedinData.currentEmployer}
`;
    if (linkedinData.linkedinSlug) {
      prompt += `LinkedIn: linkedin.com/in/${linkedinData.linkedinSlug}\n`;
    }
    if (linkedinData.websites?.length) {
      prompt += `\nPersonal websites:\n`;
      for (const site of linkedinData.websites) {
        prompt += `- ${site}\n`;
      }
    }
    if (linkedinData.careerHistory?.length) {
      prompt += `\nCareer history:\n`;
      for (const role of linkedinData.careerHistory) {
        prompt += `- ${role.title} at ${role.employer} (${role.startDate}–${role.endDate})\n`;
        if (role.description) {
          prompt += `  ${role.description}\n`;
        }
      }
    }
    if (linkedinData.education?.length) {
      prompt += `\nEducation:\n`;
      for (const edu of linkedinData.education) {
        prompt += `- ${edu.institution}: ${edu.degree || ''} in ${edu.field || ''}\n`;
      }
    }
    if (linkedinData.boards?.length) {
      prompt += `\nBoard positions:\n`;
      for (const board of linkedinData.boards) {
        prompt += `- ${board}\n`;
      }
    }
    if (linkedinData.skills?.length) {
      prompt += `\nSkills: ${linkedinData.skills.join(', ')}\n`;
    }
    prompt += '\n';
  }

  if (seedUrl) {
    prompt += `## SEED URL: ${seedUrl}\n\n`;
    if (seedUrlContent) {
      prompt += `Content from seed URL (use this to identify their writing voice, frameworks, specific initiatives, and topics to search for):\n\n`;
      prompt += seedUrlContent.slice(0, 30000);
      prompt += '\n\n';
    }
  }

  return prompt;
}

// ── Deep Research Developer Prompt ────────────────────────────────

const DEEP_RESEARCH_DEVELOPER_PROMPT = `You are a behavioral research analyst building a donor intelligence dossier. Your job is to find and preserve evidence about how a specific person thinks, decides, communicates, builds trust, and responds to pressure.

You will receive a research strategy prepared by an analyst that includes identity resolution, a coverage map, 30-80 specific search queries, and stopping rules. USE THIS STRATEGY. Execute the queries. Follow the coverage map. Apply the stopping rules.

RESEARCH APPROACH:
- Execute ALL queries in the research strategy, not a subset.
- Search broadly and deeply. Aim for 60-100+ web searches.
- After executing the provided queries, generate additional queries based on what you've found — names, organizations, initiatives, and events that emerged from initial results.
- Prioritize the subject's own writing and speaking: blog posts, newsletter essays, LinkedIn articles, podcast appearances, conference talks, op-eds.
- Read the subject's personal website/blog thoroughly — read individual posts, not just the homepage.
- Also find third-party coverage: press articles, interviews where they're quoted, organizational profiles, event bios.
- Look across their entire career, not just current role.

RELEVANCE FILTER:
A fact is "relevant" if it materially informs at least one of:
- Capacity: money, control, gatekeeping, decision authority
- Propensity: ideology, interests, historical giving behavior
- Access: relationships, shared affiliations, social graph
- Style: how they decide, what they reward, ego dynamics, risk tolerance, communication patterns
- Risk: what could blow up a relationship or association

If a fact doesn't map to one of these, exclude it even if it's "interesting." No trivia (food, pets, workouts, sports teams) unless it directly signals identity, worldview, status, or relationships.

"PROBATIVE TASTE" RULE:
Taste/status/class signals are included ONLY when they:
- Imply a donor "tribe" or affinity group
- Imply likely affinities or aversions
- Correlate with network access or self-concept

EVIDENCE DISCIPLINE:
- Preserve the subject's EXACT WORDS in long quotes (50-200 words per quote). Do not paraphrase.
- Every factual claim must have an inline citation.
- If uncertain about identity match, label as uncertain and explain why.
- DO NOT analyze, interpret, or draw conclusions. Your job is to find and preserve evidence, not to assess it.
- DO NOT write sentences like "This shows he values X" or "This suggests she believes Y." Just present the quote and its context.

IDENTITY DISCIPLINE:
- Use the identity resolution block to confirm matches.
- For each major claim, check: matching employer, location, role dates, co-mentions.
- If you find multiple plausible matches for the name, split them into Candidate A/B/C and do not merge until resolved.

COVERAGE REQUIREMENTS:
Follow the coverage map provided. Minimum standards:
- At least 25 unique sources total
- At least 8 primary voice sources (their own writing/speaking)
- At least 5 professional coverage sources
- At least 3 financial/philanthropic sources (if findable)
- At least 3 network/relationship sources
- Controversy section completed (even if "none found")
- At least 20 unique named entities in network map

"MORE IS MORE" STOPPING RULE:
Continue searching until:
(a) You have met the coverage map minimums, AND
(b) Search results begin repeating the same facts with no new entities or topics emerging.
You must explicitly report which categories are thin and what you tried.

OUTPUT FORMAT:
Return a structured dossier with these sections:

1. RESEARCH SUMMARY
   3-4 sentences: who this person is and what shape the evidence takes.

2. IDENTITY & DISAMBIGUATION
   Confirmed identity details. Any same-name risks resolved.

3. KEY TIMELINE
   Table: date range | role | organization | location | source
   Bullet-proof dates only. Mark uncertain dates.

4. PRIMARY VOICE EVIDENCE
   Their own writing, speaking, and publishing. For each source:
   - Long direct quote (50-200 words, exact language)
   - Source: title, publication, date, URL
   - Shape: what kind of document (blog post, interview, etc.)
   - Context: 2-3 sentences on what prompted this, who they were speaking to, what they were responding to

5. NETWORKS
   Structured list:
   Person/Org → relationship type → evidence → source

6. MONEY & VEHICLES
   Philanthropic vehicles, giving history, political donations, investment vehicles. Cite filings where available.

7. PUBLIC VOICE & WORLDVIEW
   Ideological positions, values statements, policy positions. Use direct quotes, not summaries.

8. REPUTATION / CONTROVERSY / RISK
   Lawsuits, regulatory issues, criticism, conflicts of interest. Or explicitly: "No controversy found after searching [list what you searched]."

9. RECENT ACTIVITY (last 18 months)
   New roles, funding announcements, major public statements.

10. HIGH-SIGNAL MISCELLANY
    Probative taste/status/class signals only. Each item must pass the relevance filter.

11. EVIDENCE GAPS & NEXT QUERIES
    - Which coverage categories are thin?
    - Where are claims uncited?
    - What is likely missing given this person's seniority?
    - 10 additional queries that would likely produce new signal

12. SOURCES CONSULTED
    Numbered list of every source read, with URL, title, and one-line description.

SELF-CHECK (run before finalizing):
- What categories are thin?
- Where are claims uncited?
- What is likely missing given the person's seniority?
- Did we accidentally include trivia?
- What are 10 additional queries that would likely produce new signal?

TARGET LENGTH: The dossier should be 15,000-40,000 words. This is a research document, not a summary. Length comes from preserving full quotes and rich context, not from analysis or commentary.`;

// ── Build User Prompt (per-donor) ─────────────────────────────────

function buildDeepResearchUserPrompt(
  donorName: string,
  linkedinData: LinkedInData | null,
  seedUrl: string | null,
  seedUrlContent: string | null,
  researchStrategy: string,
): string {
  let prompt = `# DONOR RESEARCH REQUEST\n\n`;

  // Campaign context
  prompt += `## CAMPAIGN CONTEXT\n`;
  prompt += `Organization: Democracy Takes Work (DTW)\n`;
  prompt += `Mission: Supporting workplace organization movements\n`;
  prompt += `Meeting type: Donor cultivation / major gift prospect\n`;
  prompt += `What we need: How this person decides to fund, what moves them, what sets them off, how to build trust, what risks exist.\n\n`;

  // Donor identity
  prompt += `## DONOR: ${donorName}\n\n`;

  // LinkedIn data (if available)
  if (linkedinData) {
    prompt += `## LINKEDIN PROFILE DATA\n`;
    prompt += `Current role: ${linkedinData.currentTitle} at ${linkedinData.currentEmployer}\n`;

    if (linkedinData.linkedinSlug) {
      prompt += `LinkedIn: linkedin.com/in/${linkedinData.linkedinSlug}\n`;
    }

    if (linkedinData.websites?.length) {
      prompt += `\nPersonal websites:\n`;
      for (const site of linkedinData.websites) {
        prompt += `- ${site}\n`;
      }
    }

    if (linkedinData.careerHistory?.length) {
      prompt += `\nCareer history:\n`;
      for (const role of linkedinData.careerHistory) {
        prompt += `- ${role.title} at ${role.employer} (${role.startDate}–${role.endDate})\n`;
        if (role.description) {
          prompt += `  ${role.description}\n`;
        }
      }
    }

    if (linkedinData.education?.length) {
      prompt += `\nEducation:\n`;
      for (const edu of linkedinData.education) {
        prompt += `- ${edu.institution}: ${edu.degree || ''} in ${edu.field || ''}\n`;
      }
    }

    if (linkedinData.boards?.length) {
      prompt += `\nBoard positions:\n`;
      for (const board of linkedinData.boards) {
        prompt += `- ${board}\n`;
      }
    }

    prompt += `\n`;
  }

  // Seed URL (if available)
  if (seedUrl) {
    prompt += `## SEED URL: ${seedUrl}\n\n`;
    if (seedUrlContent) {
      prompt += `Content from seed URL (use this to identify their writing voice, frameworks, specific initiatives, and topics to search for):\n\n`;
      prompt += seedUrlContent.slice(0, 30000);
      prompt += `\n\n`;
    }
  }

  // Research strategy (Sonnet's output)
  prompt += `## RESEARCH STRATEGY\n\n`;
  prompt += `The following research strategy was prepared by an analyst. Execute it thoroughly.\n\n`;
  prompt += researchStrategy;
  prompt += `\n\n`;

  // Final instruction
  prompt += `## INSTRUCTION\n`;
  prompt += `Execute the research strategy above. Search broadly and deeply. Produce the dossier in the format specified in your operator instructions. Aim for maximum relevant surface area.\n`;

  return prompt;
}

// ── Execute Research Strategy (Sonnet) ────────────────────────────

async function executeResearchStrategy(
  donorName: string,
  linkedinData: LinkedInData | null,
  seedUrl: string | null,
  seedUrlContent: string | null,
  onProgress?: ProgressCallback,
  abortSignal?: AbortSignal,
): Promise<string> {
  const emit = onProgress || (() => {});
  emit('Building research strategy (Sonnet)...', 'research', 3, 38);

  const strategyPrompt = buildResearchStrategyPrompt(
    donorName,
    linkedinData,
    seedUrl,
    seedUrlContent,
  );

  console.log(`[DeepResearch] Research strategy prompt: ${strategyPrompt.length} chars`);

  if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');

  const strategy = await complete(
    RESEARCH_STRATEGY_SYSTEM,
    strategyPrompt,
    { maxTokens: 8192 }
  );

  console.log(`[DeepResearch] Research strategy: ${strategy.length} chars`);
  emit(`Research strategy complete — ${strategy.length} chars`, 'research', 5, 38);

  // Debug save
  try {
    mkdirSync('/tmp/prospectai-outputs', { recursive: true });
    writeFileSync('/tmp/prospectai-outputs/DEBUG-research-strategy.txt', strategy);
  } catch (e) { /* ignore */ }

  return strategy;
}

// ── Execute Deep Research (OpenAI o3-deep-research) ───────────────

async function executeDeepResearch(
  donorName: string,
  linkedinData: LinkedInData | null,
  seedUrl: string | null,
  seedUrlContent: string | null,
  researchStrategy: string,
  onProgress?: ProgressCallback,
  abortSignal?: AbortSignal,
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
    researchStrategy,
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
    background: true,
    store: true,
  } as any);

  // Poll every 10 seconds — abort-aware, max 30 minutes
  const MAX_POLL_DURATION_MS = 30 * 60 * 1000;
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

    // Count searches so far (only populated on completion, but check anyway)
    const searches = result.output?.filter(
      (item: any) => item.type === 'web_search_call'
    ).length || 0;

    const elapsed = Date.now() - startTime;
    const elapsedMin = Math.floor(elapsed / 60000);
    const elapsedSec = Math.round(elapsed / 1000);

    if (searches !== lastSearchCount) {
      lastSearchCount = searches;
      console.log(`[DeepResearch] Polling: ${searches} searches, ${elapsedSec}s elapsed, status=${result.status}`);
    }

    // Honest, time-aware progress messages
    // OpenAI doesn't expose granular progress, but these stages are all real
    const timeLabel = elapsedMin >= 1 ? `${elapsedMin}m elapsed` : `${elapsedSec}s elapsed`;
    let progressMsg: string;
    if (result.status === 'queued') {
      progressMsg = `Deep research queued — waiting for OpenAI to start (${timeLabel})`;
    } else if (elapsedMin < 2) {
      progressMsg = `Deep research underway — searching the web (${timeLabel})`;
    } else if (elapsedMin < 5) {
      progressMsg = `Deep research underway — reading and analyzing sources (${timeLabel})`;
    } else if (elapsedMin < 10) {
      progressMsg = `Deep research underway — cross-referencing findings (${timeLabel})`;
    } else if (elapsedMin < 15) {
      progressMsg = `Deep research underway — building dossier (${timeLabel})`;
    } else {
      progressMsg = `Deep research underway — synthesizing results (${timeLabel})`;
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
): Promise<DeepResearchResult> {
  const emit = onProgress || (() => {});

  // Determine seed URL (use first one if multiple)
  const seedUrl = seedUrls.length > 0 ? seedUrls[0] : null;

  // Stage 1: Research Strategy (Sonnet)
  emit('Stage 1: Building research strategy...', 'research', 2, 38);

  const researchStrategy = await executeResearchStrategy(
    donorName,
    linkedinData,
    seedUrl,
    seedUrlContent,
    onProgress,
    abortSignal,
  );

  // Stage 2: Deep Research (OpenAI o3-deep-research)
  emit('Stage 2: Launching deep research...', 'research', 6, 38);

  const { dossier, citations, searchCount, tokenUsage, durationMs } = await executeDeepResearch(
    donorName,
    linkedinData,
    seedUrl,
    seedUrlContent,
    researchStrategy,
    onProgress,
    abortSignal,
  );

  return {
    dossier,
    citations,
    searchCount,
    tokenUsage,
    durationMs,
    researchStrategy,
  };
}
