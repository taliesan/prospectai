/**
 * Conversation Pipeline Architecture (v5)
 *
 * Stage 1: Source Collection
 *   - Identity verification, query generation, source gathering
 *   - Output: sources with full content
 *
 * Stage 2: Behavioral Evidence Extraction
 *   - Input: all sources with full content
 *   - Process: extract behavioral evidence across 24 dimensions
 *   - Output: quote + source + context entries (no interpretation)
 *
 * Stage 3: Profile Generation
 *   - Input: Geoffrey Block + extraction output + output instructions
 *   - Output: Persuasion Profile (18 sections, user-facing)
 *
 * Stage 4: Meeting Guide Generation
 *   - Input: Persuasion Profile + Meeting Guide Block + MG Exemplars + DTW Org Layer
 *   - Output: Meeting Guide (tactical choreography, user-facing)
 *
 * Key terms:
 *   - "Extraction" = behavioral evidence with quotes (intermediate, not user-facing)
 *   - "Persuasion Profile" = final 18-section output (user-facing)
 */

import { conversationTurn, Message } from './anthropic';
import { conductResearch } from './pipeline';
import { loadExemplars, loadGeoffreyBlock, loadMeetingGuideBlock, loadMeetingGuideExemplars, loadDTWOrgLayer } from './canon/loader';
import { buildMeetingGuidePrompt } from './prompts/meeting-guide';
import { buildExtractionPrompt } from './prompts/extraction-prompt';
import { buildProfilePrompt } from './prompts/profile-prompt';
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
  console.log(`CONVERSATION MODE (v5 extraction pipeline): Processing ${donorName}`);
  console.log(`${'='.repeat(60)}\n`);

  const TOTAL_STEPS = 33;

  // ─── Stage 1: Source Collection ─────────────────────────────────────
  onProgress(`Building intelligence profile for ${donorName}`, undefined, 1, TOTAL_STEPS);
  onProgress('', 'research'); // phase transition event

  const research = await conductResearch(donorName, seedUrls, searchFunction, fetchFunction, onProgress);

  onProgress(`✓ Research complete — ${research.sources.length} verified sources`, 'research', 15, TOTAL_STEPS);
  console.log(`[Conversation] Research complete: ${research.sources.length} sources`);

  // ─── Stage 2: Behavioral Evidence Extraction ────────────────────────
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

  // Build extraction prompt with token budget management
  const MAX_TOKENS = 180000;
  let extractionPromptText = buildExtractionPrompt(donorName, rankedSources);
  let extractionEstimate = estimateTokens(extractionPromptText);

  console.log(`[Conversation] Extraction prompt token estimate: ${extractionEstimate} (max: ${MAX_TOKENS})`);

  let sourcesToUse = rankedSources;
  if (extractionEstimate > MAX_TOKENS) {
    console.log(`[Conversation] Token budget exceeded, truncating sources for extraction...`);
    while (extractionEstimate > MAX_TOKENS && sourcesToUse.length > 10) {
      sourcesToUse = sourcesToUse.slice(0, Math.floor(sourcesToUse.length * 0.8));
      extractionPromptText = buildExtractionPrompt(donorName, sourcesToUse);
      extractionEstimate = estimateTokens(extractionPromptText);
    }
    console.log(`[Conversation] Truncated to ${sourcesToUse.length} sources, ~${extractionEstimate} tokens`);
  }

  onProgress(`Extracting behavioral evidence from ${sourcesToUse.length} sources across 24 dimensions`, 'analysis', 17, TOTAL_STEPS);
  console.log('[Conversation] Stage 2: Extracting behavioral evidence...');

  const extractionMessages: Message[] = [{ role: 'user', content: extractionPromptText }];
  const extractionPromise = conversationTurn(extractionMessages, { maxTokens: 16000 });

  // Timed intermediate updates during extraction
  let extractionDone = false;
  const extractionTimers = [
    setTimeout(() => { if (!extractionDone) onProgress('Scanning for decision-making patterns and trust signals', 'analysis', 18, TOTAL_STEPS); }, 15000),
    setTimeout(() => { if (!extractionDone) onProgress('Mapping emotional triggers, contradiction patterns, and retreat behaviors', 'analysis', 19, TOTAL_STEPS); }, 30000),
    setTimeout(() => { if (!extractionDone) onProgress('Extracting interpersonal tells, tempo signals, and conditional forks', 'analysis', 20, TOTAL_STEPS); }, 45000),
  ];

  const extractionOutput = await extractionPromise;
  extractionDone = true;
  extractionTimers.forEach(clearTimeout);

  onProgress(`✓ Behavioral evidence extracted — ${extractionOutput.length} characters`, 'analysis', 21, TOTAL_STEPS);
  console.log(`[Conversation] Extraction complete: ${extractionOutput.length} chars`);

  // [DEBUG] Save extraction output for audit
  try {
    mkdirSync('/tmp/prospectai-outputs', { recursive: true });
    writeFileSync('/tmp/prospectai-outputs/DEBUG-extraction.txt', extractionOutput);
    console.log(`[DEBUG] Extraction output saved (${extractionOutput.length} chars)`);
  } catch (e) { console.warn('[DEBUG] Failed to save extraction output:', e); }

  // ─── Stage 3: Profile Generation ────────────────────────────────────
  onProgress('Writing Persuasion Profile from behavioral evidence', 'analysis', 22, TOTAL_STEPS);
  console.log('[Conversation] Stage 3: Generating Persuasion Profile...');

  const profilePromptText = buildProfilePrompt(donorName, extractionOutput, geoffreyBlock);
  const profileTokenEstimate = estimateTokens(profilePromptText);
  console.log(`[Conversation] Profile prompt token estimate: ${profileTokenEstimate}`);

  // [DEBUG] Save full profile prompt for audit
  try {
    writeFileSync('/tmp/prospectai-outputs/DEBUG-prompt.txt', profilePromptText);
    console.log(`[DEBUG] Profile prompt saved (${profilePromptText.length} chars)`);
  } catch (e) { console.warn('[DEBUG] Failed to save profile prompt:', e); }

  const profileMessages: Message[] = [{ role: 'user', content: profilePromptText }];
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

  // ─── Stage 4: Meeting Guide Generation ──────────────────────────────
  onProgress('', 'writing'); // phase transition event
  onProgress('Loading meeting strategy framework', 'writing', 28, TOTAL_STEPS);
  console.log('[Conversation] Stage 4: Generating meeting guide from profile...');

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
    draft: extractionOutput,            // Extraction output (intermediate, for debug)
    critique: ''
  };
}
