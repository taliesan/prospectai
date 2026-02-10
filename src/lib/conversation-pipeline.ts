// Conversation-mode pipeline for donor profiling
// Two-step architecture: sources → dossier → profile
// Both steps governed by the Geoffrey Block
// v3: Uses tiered sources with tier labels and evidence gap warnings

import { conversationTurn, Message } from './anthropic';
import { conductResearch, rankAndSortSources } from './pipeline';
import { loadExemplars, loadGeoffreyBlock, loadMeetingGuideBlock, loadMeetingGuideExemplars, loadDTWOrgLayer } from './canon/loader';
import { buildMeetingGuidePrompt } from './prompts/meeting-guide';
import {
  tierSources,
  TieredSource,
  TIER_PREAMBLE,
  formatSourcesForDossier,
  truncateToTokenBudget,
  buildEvidenceGapBlock
} from './research/tiering';

// Types (re-exported from pipeline.ts)
export interface ResearchResult {
  donorName: string;
  identity: any;
  queries: { query: string; category: string }[];
  sources: { url: string; title: string; snippet: string; content?: string }[];
  rawMarkdown: string;
  tier1Count?: number;
  tier2Count?: number;
  tier3Count?: number;
  evidenceWarnings?: string[];
}

export interface ConversationResult {
  research: ResearchResult;
  profile: string;
  dossier: string;
  meetingGuide: string;
  draft: string;
  critique: string;
}

// Token estimation (rough: 4 chars per token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Dossier prompt - embedded here as specified
const DOSSIER_PROMPT = `You are writing a Persuasion Profile for donor profiling.

REGISTER RULES (non-negotiable):
- Write from inside the subject's behavioral logic, not about it from outside.
- Biography becomes behavioral force: not "she co-founded Recode" but "she exits institutions before they soften her edge."
- Traits become pressure-read results: not "she's direct" but "she tests for posture misalignment in the first 10 minutes."
- Values become posture in the room: not "she appreciates dialogue" but "she'll say 'interesting' and never take the meeting again."
- Psychological interpretation becomes pattern exposure: not "she gets frustrated" but "when someone uses her platform without matching her literacy, she switches to interview mode and doesn't come back."
- Every claim must be grounded in specific evidence from the sources — quotes, decisions, actions, patterns across appearances.

OUTPUT STRUCTURE (18 sections):

## Life and Career
Write 2-3 paragraphs summarizing this person's biographical background and career arc. Include: where they came from, key career moves, current position/focus, and any relevant personal facts (family, education, geography). This section is factual context-setting, not behavioral analysis — save insights for the later sections.

Then write one section for each of these 17 behavioral dimensions. Use the dimension name as the section header. Write substantive prose for each — this is long-form analysis, not bullet points.

1. Decision-Making Patterns
2. Trust Calibration
3. Influence Susceptibility
4. Communication Style
5. Learning Style
6. Time Orientation
7. Identity & Self-Concept
8. Values Hierarchy
9. Status & Recognition
10. Boundary Conditions
11. Emotional Triggers
12. Relationship Patterns
13. Risk Tolerance
14. Resource Philosophy
15. Commitment Patterns
16. Knowledge Areas
17. Contradiction Patterns — MOST IMPORTANT. Contradictions reveal where persuasion has maximum leverage.

OUTPUT: Long-form behavioral prose organized by the 18 sections above (Life and Career + 17 dimensions). Not bullet points. Each section should have a clear header and substantive analysis. Cross-reference across sources. Surface every signal, every quote, every contradiction, every conspicuous silence. Be expansive — more is more.`;

/**
 * Build Step 1 prompt: Geoffrey Block + tier preamble + tiered sources + dossier instruction
 * v3: Sources now include tier labels and evidence gap warnings
 */
function buildDossierPrompt(
  donorName: string,
  sources: TieredSource[] | { url: string; title: string; snippet: string; content?: string; tier?: number }[],
  geoffreyBlock: string,
  evidenceWarnings?: string[]
): string {
  // Check if sources are tiered
  const hasTiers = sources.length > 0 && 'tier' in sources[0] && 'tierReason' in sources[0];

  let sourcesText: string;
  if (hasTiers) {
    sourcesText = formatSourcesForDossier(sources as TieredSource[]);
  } else {
    sourcesText = sources.map((s, i) => {
      const tierLabel = s.tier ? ` [TIER ${s.tier}]` : '';
      return `### Source ${i + 1}${tierLabel}: ${s.title}\nURL: ${s.url}\nSnippet: ${s.snippet}${s.content ? `\nContent: ${s.content}` : ''}`;
    }).join('\n\n');
  }

  // Build evidence gap block if there are warnings
  const evidenceGapBlock = evidenceWarnings?.length
    ? buildEvidenceGapBlock(evidenceWarnings)
    : '';

  return `${geoffreyBlock}

---

${hasTiers ? TIER_PREAMBLE : ''}

Here are ${sources.length} research sources about ${donorName}:

${sourcesText}

---

${evidenceGapBlock}

${DOSSIER_PROMPT}

Title the document "${donorName} — Persuasion Profile" at the top.

Write a comprehensive Persuasion Profile for ${donorName}.`;
}

/**
 * Build Step 2 prompt: Geoffrey Block + exemplars + dossier + instruction
 */
function buildProfilePrompt(
  donorName: string,
  dossier: string,
  geoffreyBlock: string,
  exemplars: string
): string {
  return `${geoffreyBlock}

---

${exemplars}

---

Here is the behavioral dossier for ${donorName}:

${dossier}

---

Write a complete 7-section donor persuasion profile for ${donorName}. Organize the dossier into the profile format demonstrated by the exemplars. Every sentence must pass the register rules in the Geoffrey Block. Every section must be load-bearing.

The dossier is already in the right voice. Your job is to structure and select, not to rewrite. Preserve the explanatory texture. When the dossier says "She saw classifieds revenue declining at the Washington Post and tried to warn executives about Craigslist, they dismissed her. She didn't argue — she left," that's the register. Don't compress it into "She exits institutions before they soften her edge." Keep the example. Keep the explanation. The profile organizes the dossier into seven sections — it doesn't translate it into a different, tighter language.

Headers compress, body text explains.

CRITICAL: The seven numbered section headers are fixed structural labels. Use them exactly as written:

1. Donor Identity & Background
2. Core Motivations, Values & Triggers
3. Ideal Engagement Style
4. Challenges & Risk Factors
5. Strategic Opportunities for Alignment
6. Tactical Approach to the Meeting
7. Dinner Party Test

You generate subsection headers and all content within each section. You do NOT rephrase or replace the numbered section headers. They are identical across every profile.`;
}

// Progress callback type matching the new phase/step signature
type PipelineProgressCallback = (message: string, phase?: string, step?: number, totalSteps?: number) => void;

/**
 * Main conversation pipeline - two-step architecture
 * Step 1: sources → dossier
 * Step 2: dossier → profile
 * v3: Uses tiered sources with tier labels in dossier prompt
 */
export async function runConversationPipeline(
  donorName: string,
  seedUrls: string[] = [],
  searchFunction: (query: string) => Promise<{ url: string; title: string; snippet: string }[]>,
  fetchFunction: (url: string) => Promise<string>,
  onProgress: PipelineProgressCallback
): Promise<ConversationResult> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`CONVERSATION MODE (Two-Step v3): Processing ${donorName}`);
  console.log(`${'='.repeat(60)}\n`);

  const TOTAL_STEPS = 28;

  // ─── Phase 1: Research ───────────────────────────────────────────
  onProgress(`Building intelligence profile for ${donorName}`, undefined, 1, TOTAL_STEPS);
  onProgress('', 'research'); // phase transition event

  const research = await conductResearch(donorName, seedUrls, searchFunction, fetchFunction, onProgress);

  const t1 = research.tier1Count || 0;
  const t2 = research.tier2Count || 0;
  const t3 = research.tier3Count || 0;
  onProgress(`✓ Research complete — ${research.sources.length} verified sources (${t1} T1, ${t2} T2, ${t3} T3)`, 'research', 15, TOTAL_STEPS);
  console.log(`[Conversation] Research complete: ${research.sources.length} sources (T1:${t1} T2:${t2} T3:${t3})`);

  // ─── Phase 2: Analysis ───────────────────────────────────────────
  onProgress('', 'analysis'); // phase transition event

  // Load canon documents
  const geoffreyBlock = loadGeoffreyBlock();
  const exemplars = loadExemplars();
  console.log(`[Conversation] Loaded Geoffrey Block (${geoffreyBlock.length} chars) and exemplars (${exemplars.length} chars)`);

  // v3: Use tiered sources directly from research (already tiered by pipeline)
  // Re-tier if sources don't have tier info (backward compat)
  let tieredSources: TieredSource[];
  if (research.sources.length > 0 && 'tier' in research.sources[0] && 'tierReason' in research.sources[0]) {
    tieredSources = research.sources as TieredSource[];
  } else {
    tieredSources = tierSources(research.sources, donorName);
  }

  // Sort by tier for display
  tieredSources.sort((a, b) => a.tier - b.tier);

  const tierCounts = { 1: 0, 2: 0, 3: 0 };
  for (const s of tieredSources) {
    if (s.tier >= 1 && s.tier <= 3) tierCounts[s.tier as 1 | 2 | 3]++;
  }

  onProgress(
    `Ranking sources — ${tierCounts[1]} subject's voice, ${tierCounts[2]} third-party quotes, ${tierCounts[3]} background`,
    'analysis', 16, TOTAL_STEPS
  );

  // Prepare sources with token budget management
  const MAX_TOKENS = 180000;
  let dossierPrompt = buildDossierPrompt(donorName, tieredSources, geoffreyBlock, research.evidenceWarnings);
  let estimatedTokens = estimateTokens(dossierPrompt);

  console.log(`[Conversation] Dossier prompt token estimate: ${estimatedTokens} (max: ${MAX_TOKENS})`);

  let sourcesToUse = tieredSources;
  if (estimatedTokens > MAX_TOKENS) {
    console.log(`[Conversation] Token budget exceeded, using tier-aware truncation...`);
    // v3: Use tier-aware truncation (drops Tier 3 first, preserves Tier 1)
    const maxSourceTokens = MAX_TOKENS - estimateTokens(geoffreyBlock) - estimateTokens(DOSSIER_PROMPT) - 5000; // 5k buffer
    sourcesToUse = truncateToTokenBudget(tieredSources, maxSourceTokens);
    dossierPrompt = buildDossierPrompt(donorName, sourcesToUse, geoffreyBlock, research.evidenceWarnings);
    estimatedTokens = estimateTokens(dossierPrompt);
    console.log(`[Conversation] Tier-aware truncation: ${sourcesToUse.length} sources, ~${estimatedTokens} tokens`);
  }

  onProgress(`Preparing ${sourcesToUse.length} sources for behavioral analysis`, 'analysis', 17, TOTAL_STEPS);

  // Generate dossier with timed intermediate updates
  onProgress('Analyzing behavioral patterns across all sources', 'analysis', 18, TOTAL_STEPS);
  console.log('[Conversation] Step 1: Generating dossier...');

  const dossierMessages: Message[] = [{ role: 'user', content: dossierPrompt }];
  const dossierPromise = conversationTurn(dossierMessages, { maxTokens: 16000 });

  // Timed intermediate updates during the blocking API call
  let dossierDone = false;
  const dossierTimers = [
    setTimeout(() => { if (!dossierDone) onProgress('Mapping decision-making patterns and trust calibration', 'analysis', 19, TOTAL_STEPS); }, 15000),
    setTimeout(() => { if (!dossierDone) onProgress('Extracting emotional triggers and contradiction patterns', 'analysis', 20, TOTAL_STEPS); }, 30000),
    setTimeout(() => { if (!dossierDone) onProgress('Building 18-section behavioral profile', 'analysis', 21, TOTAL_STEPS); }, 50000),
  ];

  const dossier = await dossierPromise;
  dossierDone = true;
  dossierTimers.forEach(clearTimeout);

  onProgress(`✓ Behavioral analysis complete — ${dossier.length} characters of insight`, 'analysis', 22, TOTAL_STEPS);
  console.log(`[Conversation] Dossier complete: ${dossier.length} chars`);

  // Profile = Dossier in the current architecture
  const profile = dossier;
  console.log(`[Conversation] Profile complete (dossier is the profile): ${dossier.length} chars`);

  // ─── Phase 3: Writing ────────────────────────────────────────────
  onProgress('', 'writing'); // phase transition event
  onProgress('Loading meeting strategy framework', 'writing', 23, TOTAL_STEPS);
  console.log('[Conversation] Step 4: Generating meeting guide from profile...');

  const meetingGuideBlock = loadMeetingGuideBlock();
  const meetingGuideExemplars = loadMeetingGuideExemplars();
  const dtwOrgLayer = loadDTWOrgLayer();

  console.log(`[Conversation] Loaded Meeting Guide Block (${meetingGuideBlock.length} chars), Exemplars (${meetingGuideExemplars.length} chars), DTW Org Layer (${dtwOrgLayer.length} chars)`);

  const meetingGuidePrompt = buildMeetingGuidePrompt(
    donorName,
    profile,
    meetingGuideBlock,
    dtwOrgLayer,
    meetingGuideExemplars
  );

  const meetingGuideTokenEstimate = estimateTokens(meetingGuidePrompt);
  console.log(`[Conversation] Meeting guide prompt token estimate: ${meetingGuideTokenEstimate}`);

  onProgress(`Writing tactical meeting guide for ${donorName}`, 'writing', 24, TOTAL_STEPS);

  const meetingGuideMessages: Message[] = [{ role: 'user', content: meetingGuidePrompt }];
  const mgPromise = conversationTurn(meetingGuideMessages, { maxTokens: 8000 });

  // Timed intermediate updates during meeting guide generation
  let meetingGuideDone = false;
  const mgTimers = [
    setTimeout(() => { if (!meetingGuideDone) onProgress('Crafting opening moves and positioning strategy', 'writing', 25, TOTAL_STEPS); }, 15000),
    setTimeout(() => { if (!meetingGuideDone) onProgress('Designing conversation flow and ask choreography', 'writing', 26, TOTAL_STEPS); }, 30000),
  ];

  const meetingGuide = await mgPromise;
  meetingGuideDone = true;
  mgTimers.forEach(clearTimeout);

  onProgress('✓ Meeting guide complete', 'writing', 27, TOTAL_STEPS);
  console.log(`[Conversation] Meeting guide complete: ${meetingGuide.length} chars`);

  onProgress('✓ All documents ready — preparing download', undefined, 28, TOTAL_STEPS);

  console.log(`${'='.repeat(60)}`);
  console.log(`CONVERSATION MODE: Complete`);
  console.log(`${'='.repeat(60)}\n`);

  return {
    research,
    profile,        // Now equals dossier
    dossier,        // Keep for backward compatibility
    meetingGuide,
    draft: dossier,
    critique: ''
  };
}
