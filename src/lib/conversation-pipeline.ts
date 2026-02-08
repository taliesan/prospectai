/**
 * Conversation Pipeline Architecture (v2 with source scoring)
 *
 * Phase 1: Research
 *   - Identity verification, query generation, source gathering
 *   - Output: sources with full content
 *
 * Phase 2: Source Scoring & Selection
 *   - Input: all sources with full content
 *   - Process: score each source across 24 behavioral dimensions (weighted by tier)
 *   - Select top sources by score until ~30K word target reached
 *   - Output: 3-8 complete, high-signal articles
 *
 * Phase 3: Profile Generation
 *   - Input: selected full-text sources + Geoffrey Block + DOSSIER_PROMPT
 *   - Output: Persuasion Profile (18 sections, user-facing)
 *
 * Phase 4: Meeting Guide Generation
 *   - Input: Persuasion Profile + Meeting Guide Block + MG Exemplars + DTW Org Layer
 *   - Output: Meeting Guide (tactical choreography, user-facing)
 *
 * Key terms:
 *   - "Selected Sources" = top-scored full articles (intermediate, not user-facing)
 *   - "Persuasion Profile" = final 18-section output (user-facing)
 */

import { conversationTurn, Message } from './anthropic';
import { conductResearch } from './pipeline';
import { loadExemplars, loadGeoffreyBlock, loadMeetingGuideBlock, loadMeetingGuideExemplars, loadDTWOrgLayer } from './canon/loader';
import { buildMeetingGuidePrompt } from './prompts/meeting-guide';
import { buildScoringPrompt, selectTopSources } from './prompts/source-scoring';
import { writeFileSync, mkdirSync } from 'fs';

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

INCORPORATING BEHAVIORAL DYNAMICS EVIDENCE:

The sources contain evidence for 7 additional behavioral dynamics. Fold this evidence into the relevant profile sections:

- "Emotional Triggers" should incorporate: SHAME_DEFENSE_TRIGGERS, HIDDEN_FRAGILITIES
- "Communication Style" should incorporate: RETREAT_PATTERNS, TEMPO_MANAGEMENT, REAL_TIME_INTERPERSONAL_TELLS
- "Relationship Patterns" should incorporate: RECOVERY_PATHS
- "Decision-Making Patterns" should incorporate: CONDITIONAL_BEHAVIORAL_FORKS

Every behavioral claim needs both branches of the fork. Not "he's direct" but "when X, he does Y; when not-X, he does Z."

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
 * Build profile prompt from selected high-signal sources.
 * Takes the full text of top-scored sources (selected by behavioral
 * signal density) instead of raw source arrays or extraction output.
 */
function buildDossierPromptFromEvidence(
  donorName: string,
  evidenceText: string,
  geoffreyBlock: string
): string {
  return `${geoffreyBlock}

---

Here are the highest-signal research sources about ${donorName}, selected and ranked by behavioral evidence density:

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
 * Main conversation pipeline — see architecture comment at top of file.
 */
export async function runConversationPipeline(
  donorName: string,
  seedUrls: string[] = [],
  searchFunction: (query: string) => Promise<{ url: string; title: string; snippet: string }[]>,
  fetchFunction: (url: string) => Promise<string>,
  onProgress: PipelineProgressCallback
): Promise<ConversationResult> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`CONVERSATION MODE (v2 with source scoring): Processing ${donorName}`);
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

  // Prepare sources with token budget management for scoring prompt
  const MAX_TOKENS = 180000;
  let scoringEstimate = estimateTokens(buildScoringPrompt(donorName, rankedSources));

  console.log(`[Conversation] Scoring prompt token estimate: ${scoringEstimate} (max: ${MAX_TOKENS})`);

  let sourcesToUse = rankedSources;
  if (scoringEstimate > MAX_TOKENS) {
    console.log(`[Conversation] Token budget exceeded, truncating sources for scoring...`);
    while (scoringEstimate > MAX_TOKENS && sourcesToUse.length > 10) {
      sourcesToUse = sourcesToUse.slice(0, Math.floor(sourcesToUse.length * 0.8));
      scoringEstimate = estimateTokens(buildScoringPrompt(donorName, sourcesToUse));
    }
    console.log(`[Conversation] Truncated to ${sourcesToUse.length} sources, ~${scoringEstimate} tokens`);
  }

  onProgress(`Preparing ${sourcesToUse.length} sources for behavioral scoring`, 'analysis', 17, TOTAL_STEPS);

  // ─── Step 4: Score Sources for Behavioral Signal Density ───────────
  onProgress('Scoring sources for behavioral signal density', 'scoring', 18, TOTAL_STEPS);
  console.log('[Conversation] Step 4: Scoring sources for behavioral signal density...');

  const scoringPrompt = buildScoringPrompt(donorName, sourcesToUse);
  const scoringTokenEstimate = estimateTokens(scoringPrompt);
  console.log(`[Conversation] Scoring prompt token estimate: ${scoringTokenEstimate}`);

  const scoringMessages: Message[] = [{ role: 'user', content: scoringPrompt }];
  const scoringPromise = conversationTurn(scoringMessages, { maxTokens: 8000 });

  // Timed intermediate updates during scoring
  let scoringDone = false;
  const scoringTimers = [
    setTimeout(() => { if (!scoringDone) onProgress('Evaluating behavioral signal density across sources', 'scoring', 19, TOTAL_STEPS); }, 15000),
    setTimeout(() => { if (!scoringDone) onProgress('Weighting dimensions by meeting intelligence value', 'scoring', 20, TOTAL_STEPS); }, 30000),
  ];

  const scoringResponse = await scoringPromise;
  scoringDone = true;
  scoringTimers.forEach(clearTimeout);

  // Parse scoring response (JSON array)
  let scoredSources: Array<{ source_index: number; total_score: number; word_count: number }>;
  try {
    const jsonMatch = scoringResponse.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      scoredSources = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('No JSON array found in scoring response');
    }
  } catch (e) {
    console.error('[Conversation] Failed to parse scoring response, using fallback order:', e);
    scoredSources = sourcesToUse.map((s, i) => ({
      source_index: i + 1,
      total_score: 50,
      word_count: (s.content || s.snippet).split(/\s+/).length
    }));
  }

  onProgress(`✓ Scored ${scoredSources.length} sources`, 'scoring', 21, TOTAL_STEPS);
  console.log(`[Conversation] Scored ${scoredSources.length} sources`);

  // ─── Step 5: Select Top Sources by Score ───────────────────────────
  const TARGET_WORDS = 30000;
  const selectedSources = selectTopSources(scoredSources, sourcesToUse, TARGET_WORDS);
  const totalWords = selectedSources.reduce((sum, s) => sum + s.content.split(/\s+/).length, 0);

  onProgress(`Selected top ${selectedSources.length} sources (~${totalWords} words)`, 'selection', 22, TOTAL_STEPS);
  console.log(`[Conversation] Selected ${selectedSources.length} sources, ~${totalWords} words`);

  // Build the evidence text from selected full sources
  const behavioralEvidence = selectedSources.map((s, i) => {
    const source = sourcesToUse[s.index - 1];
    return `## SOURCE ${i + 1}: ${source.title} (Score: ${s.score})\nURL: ${source.url}\n\n${s.content}`;
  }).join('\n\n---\n\n');

  // [DEBUG] Save selected sources and scoring response for audit
  try {
    mkdirSync('/tmp/prospectai-outputs', { recursive: true });
    writeFileSync('/tmp/prospectai-outputs/DEBUG-selected-sources.txt', behavioralEvidence);
    writeFileSync('/tmp/prospectai-outputs/DEBUG-scoring-response.txt', scoringResponse);
    console.log(`[DEBUG] Selected sources saved (${behavioralEvidence.length} chars)`);
  } catch (e) { console.warn('[DEBUG] Failed to save debug files:', e); }

  // ─── Step 6: Persuasion Profile from Selected Sources ──────────────
  onProgress('Writing Persuasion Profile from top-scored sources', 'analysis', 23, TOTAL_STEPS);
  console.log('[Conversation] Step 6: Generating Persuasion Profile from selected sources...');

  const profilePrompt = buildDossierPromptFromEvidence(donorName, behavioralEvidence, geoffreyBlock);
  const profileTokenEstimate = estimateTokens(profilePrompt);
  console.log(`[Conversation] Profile prompt token estimate: ${profileTokenEstimate}`);

  // [DEBUG] Save full profile prompt for audit
  try {
    writeFileSync('/tmp/prospectai-outputs/DEBUG-profile-prompt.txt', profilePrompt);
    console.log(`[DEBUG] Profile prompt saved (${profilePrompt.length} chars)`);
  } catch (e) { console.warn('[DEBUG] Failed to save profile prompt:', e); }

  const profileMessages: Message[] = [{ role: 'user', content: profilePrompt }];
  const profilePromise = conversationTurn(profileMessages, { maxTokens: 16000 });

  // Timed intermediate updates during profile generation
  let profileDone = false;
  const profileTimers = [
    setTimeout(() => { if (!profileDone) onProgress('Mapping decision-making patterns and trust calibration', 'analysis', 24, TOTAL_STEPS); }, 15000),
    setTimeout(() => { if (!profileDone) onProgress('Extracting emotional triggers and contradiction patterns', 'analysis', 25, TOTAL_STEPS); }, 30000),
    setTimeout(() => { if (!profileDone) onProgress('Building 18-section Persuasion Profile', 'analysis', 26, TOTAL_STEPS); }, 50000),
  ];

  const persuasionProfile = await profilePromise;
  profileDone = true;
  profileTimers.forEach(clearTimeout);

  onProgress(`✓ Persuasion Profile complete — ${persuasionProfile.length} characters of insight`, 'analysis', 27, TOTAL_STEPS);
  console.log(`[Conversation] Persuasion Profile complete: ${persuasionProfile.length} chars`);

  // ─── Phase 3: Writing ────────────────────────────────────────────
  onProgress('', 'writing'); // phase transition event
  onProgress('Loading meeting strategy framework', 'writing', 28, TOTAL_STEPS);
  console.log('[Conversation] Step 7: Generating meeting guide from profile...');

  const meetingGuideBlock = loadMeetingGuideBlock();
  const meetingGuideExemplars = loadMeetingGuideExemplars();
  const dtwOrgLayer = loadDTWOrgLayer();

  console.log(`[Conversation] Loaded Meeting Guide Block (${meetingGuideBlock.length} chars), Exemplars (${meetingGuideExemplars.length} chars), DTW Org Layer (${dtwOrgLayer.length} chars)`);

  const meetingGuidePrompt = buildMeetingGuidePrompt(
    donorName,
    persuasionProfile,
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
    profile: persuasionProfile,         // Persuasion Profile (18-section, user-facing)
    dossier: persuasionProfile,         // Frontend reads dossier.rawMarkdown for display
    meetingGuide,
    draft: behavioralEvidence,          // Selected full-text sources (intermediate)
    critique: ''
  };
}
