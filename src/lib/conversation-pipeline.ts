// Conversation-mode pipeline for donor profiling
// Three-step architecture: sources → extraction (verbatim evidence) → profile
// Extraction step curates raw content into ~10-15K behavioral dossier
// Profile step feeds curated evidence into DOSSIER_PROMPT (18-section Persuasion Profile) via Geoffrey Block

import { conversationTurn, Message } from './anthropic';
import { conductResearch } from './pipeline';
import { loadExemplars, loadGeoffreyBlock, loadMeetingGuideBlock, loadMeetingGuideExemplars, loadDTWOrgLayer } from './canon/loader';
import { buildMeetingGuidePrompt } from './prompts/meeting-guide';
import { buildExtractionPrompt } from './prompts/extraction-dossier';

// Types (re-exported from pipeline.ts)
export interface ResearchResult {
  donorName: string;
  identity: any;
  queries: { query: string; category: string }[];
  sources: { url: string; title: string; snippet: string; content?: string }[];
  rawMarkdown: string;
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

// Source ranking for truncation (same logic as pipeline.ts)
function rankSourceByBehavioralValue(source: { url: string; title: string; snippet: string }): number {
  const url = source.url.toLowerCase();
  const title = (source.title || '').toLowerCase();
  const snippet = (source.snippet || '').toLowerCase();
  const combined = `${url} ${title} ${snippet}`;

  // TIER 1: Video/podcast interviews, personal writing
  const tier1Patterns = [
    /youtube\.com/, /youtu\.be/, /podcast/, /\binterview\b/,
    /medium\.com/, /substack/, /\bop-ed\b/, /\bi think\b/,
    /\bmy view\b/, /\bi believe\b/, /personal\s*(essay|blog|writing)/,
  ];
  for (const pattern of tier1Patterns) {
    if (pattern.test(combined)) return 1;
  }

  // TIER 2: Speeches, talks, in-depth profiles
  const tier2Patterns = [
    /\bspeech\b/, /\bkeynote\b/, /\bremarks\b/, /\btalk at\b/,
    /\btalks at\b/, /\bprofile\b/, /\bfeature\b/, /longform/,
    /newyorker\.com/, /theatlantic\.com/, /wired\.com/, /vanityfair\.com/,
  ];
  for (const pattern of tier2Patterns) {
    if (pattern.test(combined)) return 2;
  }

  // TIER 4: Wikipedia, bio pages, LinkedIn
  const tier4Patterns = [
    /wikipedia\.org/, /linkedin\.com/, /crunchbase\.com/,
    /bloomberg\.com\/profile/, /forbes\.com\/profile/, /\/bio\b/, /\/about\b/,
  ];
  for (const pattern of tier4Patterns) {
    if (pattern.test(combined)) return 4;
  }

  // TIER 3: News coverage, press releases (default)
  return 3;
}

function rankAndSortSources(
  sources: { url: string; title: string; snippet: string; content?: string }[]
): { url: string; title: string; snippet: string; content?: string; tier: number }[] {
  const ranked = sources.map(source => ({
    ...source,
    tier: rankSourceByBehavioralValue(source)
  }));

  ranked.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.content && !b.content) return -1;
    if (!a.content && b.content) return 1;
    return 0;
  });

  return ranked;
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
 * Build Step 1 prompt: Geoffrey Block + sources + dossier instruction
 */
function buildDossierPrompt(
  donorName: string,
  sources: { url: string; title: string; snippet: string; content?: string }[],
  geoffreyBlock: string
): string {
  const sourcesText = sources.map((s, i) =>
    `### Source ${i + 1}: ${s.title}\nURL: ${s.url}\nSnippet: ${s.snippet}${s.content ? `\nContent: ${s.content}` : ''}`
  ).join('\n\n');

  return `${geoffreyBlock}

---

Here are ${sources.length} research sources about ${donorName}:

${sourcesText}

---

${DOSSIER_PROMPT}

Title the document "${donorName} — Persuasion Profile" at the top.

Write a comprehensive Persuasion Profile for ${donorName}.`;
}

/**
 * Build dossier prompt from pre-extracted behavioral evidence.
 * Same structure as buildDossierPrompt but takes curated evidence text
 * instead of raw sources — the extraction step has already distilled
 * verbatim quotes organized by 17 dimensions.
 */
function buildDossierPromptFromEvidence(
  donorName: string,
  evidenceText: string,
  geoffreyBlock: string
): string {
  return `${geoffreyBlock}

---

Here is the behavioral evidence extracted from research sources about ${donorName}:

${evidenceText}

---

${DOSSIER_PROMPT}

Title the document "${donorName} — Persuasion Profile" at the top.

Write a comprehensive Persuasion Profile for ${donorName}.`;
}

/**
 * DEPRECATED: Build Step 2 prompt (7-section format, no longer used)
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
 * Main conversation pipeline - three-step architecture
 * Step 4: sources → behavioral evidence extraction (verbatim quotes by 17 dimensions)
 * Step 5: extraction evidence → Persuasion Profile (via Geoffrey Block + DOSSIER_PROMPT)
 * Step 6: profile → meeting guide
 */
export async function runConversationPipeline(
  donorName: string,
  seedUrls: string[] = [],
  searchFunction: (query: string) => Promise<{ url: string; title: string; snippet: string }[]>,
  fetchFunction: (url: string) => Promise<string>,
  onProgress: PipelineProgressCallback
): Promise<ConversationResult> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`CONVERSATION MODE (Two-Step): Processing ${donorName}`);
  console.log(`${'='.repeat(60)}\n`);

  const TOTAL_STEPS = 33;

  // ─── Phase 1: Research ───────────────────────────────────────────
  onProgress(`Building intelligence profile for ${donorName}`, undefined, 1, TOTAL_STEPS);
  onProgress('', 'research'); // phase transition event

  const research = await conductResearch(donorName, seedUrls, searchFunction, fetchFunction, onProgress);

  onProgress(`✓ Research complete — ${research.sources.length} verified sources`, 'research', 15, TOTAL_STEPS);
  console.log(`[Conversation] Research complete: ${research.sources.length} sources`);

  // ─── Phase 2: Analysis ───────────────────────────────────────────
  onProgress('', 'analysis'); // phase transition event

  // Load canon documents
  const geoffreyBlock = loadGeoffreyBlock();
  const exemplars = loadExemplars();
  console.log(`[Conversation] Loaded Geoffrey Block (${geoffreyBlock.length} chars) and exemplars (${exemplars.length} chars)`);

  // Rank and sort sources
  const rankedSources = rankAndSortSources(research.sources);
  const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const s of rankedSources) tierCounts[s.tier as keyof typeof tierCounts]++;

  onProgress(
    `Ranking sources — ${tierCounts[1]} interviews, ${tierCounts[2]} profiles, ${tierCounts[3]} news, ${tierCounts[4]} bios`,
    'analysis', 16, TOTAL_STEPS
  );

  // Prepare sources with token budget management
  const MAX_TOKENS = 180000;
  let extractionEstimate = estimateTokens(buildExtractionPrompt(donorName, rankedSources));

  console.log(`[Conversation] Extraction prompt token estimate: ${extractionEstimate} (max: ${MAX_TOKENS})`);

  let sourcesToUse = rankedSources;
  if (extractionEstimate > MAX_TOKENS) {
    console.log(`[Conversation] Token budget exceeded, truncating sources...`);
    while (extractionEstimate > MAX_TOKENS && sourcesToUse.length > 10) {
      sourcesToUse = sourcesToUse.slice(0, Math.floor(sourcesToUse.length * 0.8));
      extractionEstimate = estimateTokens(buildExtractionPrompt(donorName, sourcesToUse));
    }
    console.log(`[Conversation] Truncated to ${sourcesToUse.length} sources, ~${extractionEstimate} tokens`);
  }

  onProgress(`Preparing ${sourcesToUse.length} sources for behavioral extraction`, 'analysis', 17, TOTAL_STEPS);

  // ─── Step 4: Behavioral Evidence Extraction ────────────────────────
  onProgress('Extracting behavioral evidence from sources', 'extraction', 18, TOTAL_STEPS);
  console.log('[Conversation] Step 4: Extracting behavioral evidence from sources...');

  const extractionPrompt = buildExtractionPrompt(donorName, sourcesToUse);
  const extractionTokenEstimate = estimateTokens(extractionPrompt);
  console.log(`[Conversation] Extraction prompt token estimate: ${extractionTokenEstimate}`);

  const extractionMessages: Message[] = [{ role: 'user', content: extractionPrompt }];
  const extractionPromise = conversationTurn(extractionMessages, { maxTokens: 16000 });

  // Timed intermediate updates during extraction
  let extractionDone = false;
  const extractionTimers = [
    setTimeout(() => { if (!extractionDone) onProgress('Pulling verbatim quotes and decision patterns', 'extraction', 19, TOTAL_STEPS); }, 15000),
    setTimeout(() => { if (!extractionDone) onProgress('Mapping emotional triggers and contradiction signals', 'extraction', 20, TOTAL_STEPS); }, 30000),
    setTimeout(() => { if (!extractionDone) onProgress('Cataloging evidence across 17 behavioral dimensions', 'extraction', 21, TOTAL_STEPS); }, 50000),
  ];

  const behavioralDossier = await extractionPromise;
  extractionDone = true;
  extractionTimers.forEach(clearTimeout);

  onProgress(`✓ Extraction complete — ${behavioralDossier.length} chars of curated evidence`, 'extraction', 22, TOTAL_STEPS);
  console.log(`[Conversation] Behavioral dossier complete: ${behavioralDossier.length} chars`);

  // ─── Step 5: Persuasion Profile from Extraction Evidence ─────────
  onProgress('Writing Persuasion Profile from curated evidence', 'analysis', 23, TOTAL_STEPS);
  console.log('[Conversation] Step 5: Generating Persuasion Profile from extraction evidence...');

  const dossierPrompt = buildDossierPromptFromEvidence(donorName, behavioralDossier, geoffreyBlock);
  const dossierTokenEstimate = estimateTokens(dossierPrompt);
  console.log(`[Conversation] Dossier prompt token estimate: ${dossierTokenEstimate}`);

  const dossierMessages: Message[] = [{ role: 'user', content: dossierPrompt }];
  const dossierPromise = conversationTurn(dossierMessages, { maxTokens: 16000 });

  // Timed intermediate updates during profile generation
  let dossierDone = false;
  const dossierTimers = [
    setTimeout(() => { if (!dossierDone) onProgress('Mapping decision-making patterns and trust calibration', 'analysis', 24, TOTAL_STEPS); }, 15000),
    setTimeout(() => { if (!dossierDone) onProgress('Extracting emotional triggers and contradiction patterns', 'analysis', 25, TOTAL_STEPS); }, 30000),
    setTimeout(() => { if (!dossierDone) onProgress('Building 18-section behavioral profile', 'analysis', 26, TOTAL_STEPS); }, 50000),
  ];

  const dossier = await dossierPromise;
  dossierDone = true;
  dossierTimers.forEach(clearTimeout);

  // Profile = Dossier (the dossier prompt produces the Persuasion Profile directly)
  const profile = dossier;

  onProgress(`✓ Persuasion Profile complete — ${dossier.length} characters of insight`, 'analysis', 27, TOTAL_STEPS);
  console.log(`[Conversation] Dossier/Profile complete: ${dossier.length} chars`);

  // ─── Phase 3: Writing ────────────────────────────────────────────
  onProgress('', 'writing'); // phase transition event
  onProgress('Loading meeting strategy framework', 'writing', 28, TOTAL_STEPS);
  console.log('[Conversation] Step 6: Generating meeting guide from profile...');

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

  onProgress(`Writing tactical meeting guide for ${donorName}`, 'writing', 29, TOTAL_STEPS);

  const meetingGuideMessages: Message[] = [{ role: 'user', content: meetingGuidePrompt }];
  const mgPromise = conversationTurn(meetingGuideMessages, { maxTokens: 8000 });

  // Timed intermediate updates during meeting guide generation
  let meetingGuideDone = false;
  const mgTimers = [
    setTimeout(() => { if (!meetingGuideDone) onProgress('Crafting opening moves and positioning strategy', 'writing', 30, TOTAL_STEPS); }, 15000),
    setTimeout(() => { if (!meetingGuideDone) onProgress('Designing conversation flow and ask choreography', 'writing', 31, TOTAL_STEPS); }, 30000),
  ];

  const meetingGuide = await mgPromise;
  meetingGuideDone = true;
  mgTimers.forEach(clearTimeout);

  onProgress('✓ Meeting guide complete', 'writing', 32, TOTAL_STEPS);
  console.log(`[Conversation] Meeting guide complete: ${meetingGuide.length} chars`);

  onProgress('✓ All documents ready — preparing download', undefined, 33, TOTAL_STEPS);

  console.log(`${'='.repeat(60)}`);
  console.log(`CONVERSATION MODE: Complete`);
  console.log(`${'='.repeat(60)}\n`);

  return {
    research,
    profile,        // Persuasion Profile (= dossier, 18-section format)
    dossier,        // Same as profile (backward compat)
    meetingGuide,
    draft: dossier,
    critique: ''
  };
}
