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
 *   - Input: Geoffrey Block + exemplars + extraction output + output instructions
 *   - Output: First draft Persuasion Profile (18 sections)
 *
 * Stage 3b: Critique and Redraft Pass (if ENABLE_CRITIQUE_REDRAFT)
 *   - Input: Geoffrey Block + exemplars + extraction output + first draft
 *   - Process: score for insight novelty and tactical value, cut/compress
 *   - Output: Final Persuasion Profile (18 sections, user-facing)
 *
 * Stage 4: Meeting Guide Generation
 *   - Input: Final Persuasion Profile + Meeting Guide Block + MG Exemplars + DTW Org Layer
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
import { buildExtractionPrompt, LinkedInData } from './prompts/extraction-prompt';
import { buildProfilePrompt } from './prompts/profile-prompt';
import { buildCritiqueRedraftPrompt } from './prompts/critique-redraft-prompt';
import { formatMeetingGuide, formatMeetingGuideEmbeddable } from './formatters/meeting-guide-formatter';
import { writeFileSync, mkdirSync } from 'fs';

// STAGE 4b: Critique and Redraft Pass
// Set to false to revert to single-pass profile generation
// Added 2026-02-09 — if output quality degrades, set to false
const ENABLE_CRITIQUE_REDRAFT = true;

// Types (re-exported from pipeline.ts)
export interface ResearchResult {
  donorName: string;
  identity: any;
  queries: { query: string; tier: string; rationale: string }[];
  sources: { url: string; title: string; snippet: string; content?: string }[];
  rawMarkdown: string;
}

export interface ConversationResult {
  research: ResearchResult;
  profile: string;
  dossier: string;
  meetingGuide: string;
  meetingGuideHtml: string;
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

// Re-export LinkedInData from canonical definition
export type { LinkedInData } from './prompts/extraction-prompt';

async function parseLinkedInText(donorName: string, linkedinText: string): Promise<LinkedInData> {
  const parsePrompt = `Extract structured biographical data from this LinkedIn profile text.

Return JSON in this exact format:
{
  "currentTitle": "their current job title",
  "currentEmployer": "their current employer",
  "careerHistory": [
    {
      "title": "Job Title",
      "employer": "Company Name",
      "startDate": "Mon YYYY",
      "endDate": "Mon YYYY or Present",
      "description": "role description if present"
    }
  ],
  "education": [
    {
      "institution": "University Name",
      "degree": "Degree Type",
      "field": "Field of Study",
      "years": "YYYY - YYYY"
    }
  ],
  "skills": ["skill1", "skill2"],
  "boards": ["Board membership 1", "Advisory role 2"]
}

Parse carefully. The PDF text may have formatting artifacts. Extract all career history entries in chronological order (most recent first).

LinkedIn Profile Text:
${linkedinText}`;

  const response = await conversationTurn([{ role: 'user', content: parsePrompt }], { maxTokens: 4000 });

  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }

  throw new Error('Failed to parse LinkedIn data');
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
  onProgress: PipelineProgressCallback,
  linkedinPdfBase64?: string
): Promise<ConversationResult> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`CONVERSATION MODE (v5 extraction pipeline): Processing ${donorName}`);
  console.log(`${'='.repeat(60)}\n`);

  const TOTAL_STEPS = 38;

  // ─── LinkedIn PDF Parsing (before research, so it informs identity & queries) ───
  let linkedinData: LinkedInData | null = null;

  if (linkedinPdfBase64) {
    console.log(`[LinkedIn] PDF received, length: ${linkedinPdfBase64.length}`);
    onProgress('Parsing LinkedIn profile...', undefined, 1, TOTAL_STEPS);

    try {
      const pdfBuffer = Buffer.from(linkedinPdfBase64, 'base64');
      console.log(`[LinkedIn] PDF buffer size: ${pdfBuffer.length}`);

      // Use unpdf for serverless-compatible PDF text extraction (no worker threads needed)
      const { extractText } = await import('unpdf');
      const { text: pdfText } = await extractText(new Uint8Array(pdfBuffer), { mergePages: true });
      console.log(`[LinkedIn] PDF text extracted, length: ${pdfText.length}`);
      console.log(`[LinkedIn] First 500 chars: ${pdfText.substring(0, 500)}`);

      linkedinData = await parseLinkedInText(donorName, pdfText);
      console.log(`[LinkedIn] Parsed data: ${JSON.stringify(linkedinData, null, 2)}`);

      // [DEBUG] Save parsed LinkedIn data
      try {
        mkdirSync('/tmp/prospectai-outputs', { recursive: true });
        writeFileSync('/tmp/prospectai-outputs/DEBUG-linkedin-data.json', JSON.stringify(linkedinData, null, 2));
        console.log('[DEBUG] LinkedIn data saved');
      } catch (e) { console.warn('[DEBUG] Failed to save LinkedIn data:', e); }

      onProgress(`✓ LinkedIn parsed — ${linkedinData.currentTitle} at ${linkedinData.currentEmployer}`, undefined, 2, TOTAL_STEPS);
    } catch (err) {
      console.error('[LinkedIn] Parsing failed:', err);
      onProgress('LinkedIn PDF parsing failed — continuing without it', undefined, 2, TOTAL_STEPS);
    }
  } else {
    console.log('[LinkedIn] No PDF provided in request');
  }

  // ─── Stage 1: Source Collection ─────────────────────────────────────
  onProgress(`Building intelligence profile for ${donorName}`, undefined, 3, TOTAL_STEPS);
  onProgress('', 'research'); // phase transition event

  const research = await conductResearch(donorName, seedUrls, searchFunction, fetchFunction, onProgress, linkedinData);

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
  let extractionPromptText = buildExtractionPrompt(donorName, rankedSources, linkedinData);
  let extractionEstimate = estimateTokens(extractionPromptText);

  console.log(`[Conversation] Extraction prompt token estimate: ${extractionEstimate} (max: ${MAX_TOKENS})`);
  console.log(`[LinkedIn] LinkedIn data passed to extraction: ${linkedinData ? 'YES' : 'NO'}`);
  if (linkedinData) {
    console.log(`[LinkedIn] Extraction prompt contains CANONICAL BIOGRAPHICAL DATA: ${extractionPromptText.includes('CANONICAL BIOGRAPHICAL DATA')}`);
  }

  let sourcesToUse = rankedSources;
  if (extractionEstimate > MAX_TOKENS) {
    console.log(`[Conversation] Token budget exceeded, truncating sources for extraction...`);
    while (extractionEstimate > MAX_TOKENS && sourcesToUse.length > 10) {
      sourcesToUse = sourcesToUse.slice(0, Math.floor(sourcesToUse.length * 0.8));
      extractionPromptText = buildExtractionPrompt(donorName, sourcesToUse, linkedinData);
      extractionEstimate = estimateTokens(extractionPromptText);
    }
    console.log(`[Conversation] Truncated to ${sourcesToUse.length} sources, ~${extractionEstimate} tokens`);
  }

  onProgress(`Extracting behavioral evidence from ${sourcesToUse.length} sources across 24 dimensions`, 'analysis', 17, TOTAL_STEPS);
  console.log('[Conversation] Stage 2: Extracting behavioral evidence...');

  // [DEBUG] Save extraction prompt (the input to Stage 2 LLM) for audit
  try {
    mkdirSync('/tmp/prospectai-outputs', { recursive: true });
    writeFileSync('/tmp/prospectai-outputs/DEBUG-extraction-prompt.txt', extractionPromptText);
    console.log(`[DEBUG] Extraction prompt saved (${extractionPromptText.length} chars)`);
  } catch (e) { console.warn('[DEBUG] Failed to save extraction prompt:', e); }

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

  const profilePromptText = buildProfilePrompt(donorName, extractionOutput, geoffreyBlock, exemplars, linkedinData);
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

  const firstDraftProfile = await profilePromise;
  profileDone = true;
  profileTimers.forEach(clearTimeout);

  console.log(`[Stage 3] Profile generation complete: ${firstDraftProfile.length} chars`);

  // Save first draft debug output (ALWAYS, regardless of flag)
  try {
    writeFileSync('/tmp/prospectai-outputs/DEBUG-profile-first-draft.txt', firstDraftProfile);
    console.log(`[DEBUG] First draft profile saved (${firstDraftProfile.length} chars)`);
  } catch (e) { console.warn('[DEBUG] Failed to save first draft:', e); }

  // ─── Stage 3b: Critique and Redraft Pass ─────────────────────────────
  // Revert by setting ENABLE_CRITIQUE_REDRAFT = false at top of file
  let finalProfile = firstDraftProfile;

  if (ENABLE_CRITIQUE_REDRAFT) {
    console.log(`[Stage 3b] Starting critique and redraft pass...`);
    onProgress('Scoring first draft against production standard...', 'analysis', 27, TOTAL_STEPS);

    const critiquePrompt = buildCritiqueRedraftPrompt(
      donorName,
      firstDraftProfile,
      geoffreyBlock,
      exemplars,
      extractionOutput,
      linkedinData
    );

    // Save critique prompt for debugging
    try {
      writeFileSync('/tmp/prospectai-outputs/DEBUG-critique-prompt.txt', critiquePrompt);
      console.log(`[DEBUG] Critique prompt saved (${critiquePrompt.length} chars)`);
    } catch (e) { console.warn('[DEBUG] Failed to save critique prompt:', e); }
    console.log(`[Stage 3b] Critique prompt token estimate: ${estimateTokens(critiquePrompt)}`);

    onProgress('Applying editorial pass...', 'analysis', 28, TOTAL_STEPS);

    const critiqueMessages: Message[] = [{ role: 'user', content: critiquePrompt }];
    const critiquePromise = conversationTurn(critiqueMessages, { maxTokens: 16000 });

    // Timed intermediate updates during critique
    let critiqueDone = false;
    const critiqueTimers = [
      setTimeout(() => { if (!critiqueDone) onProgress('Scoring for insight novelty and redundancy', 'analysis', 29, TOTAL_STEPS); }, 15000),
      setTimeout(() => { if (!critiqueDone) onProgress('Cutting horizontal restatement, compressing low-value passages', 'analysis', 30, TOTAL_STEPS); }, 30000),
    ];

    finalProfile = await critiquePromise;
    critiqueDone = true;
    critiqueTimers.forEach(clearTimeout);

    // Save final profile debug output
    try {
      writeFileSync('/tmp/prospectai-outputs/DEBUG-profile-final.txt', finalProfile);
      console.log(`[DEBUG] Final profile saved (${finalProfile.length} chars)`);
    } catch (e) { console.warn('[DEBUG] Failed to save final profile:', e); }

    const reduction = Math.round((1 - finalProfile.length / firstDraftProfile.length) * 100);
    console.log(`[Stage 3b] Complete: ${firstDraftProfile.length} → ${finalProfile.length} chars (${reduction}% reduction)`);
    onProgress(`✓ Editorial pass complete — ${reduction}% tighter`, 'analysis', 31, TOTAL_STEPS);
  } else {
    console.log(`[Stage 3b] Skipped (ENABLE_CRITIQUE_REDRAFT = false)`);
    onProgress(`✓ Persuasion Profile complete — ${finalProfile.length} characters of insight`, 'analysis', 27, TOTAL_STEPS);
  }

  // ─── Stage 4: Meeting Guide Generation ──────────────────────────────
  onProgress('', 'writing'); // phase transition event
  onProgress('Loading meeting strategy framework', 'writing', 33, TOTAL_STEPS);
  console.log('[Conversation] Stage 4: Generating meeting guide from profile...');

  const meetingGuideBlock = loadMeetingGuideBlock();
  const meetingGuideExemplars = loadMeetingGuideExemplars();
  const dtwOrgLayer = loadDTWOrgLayer();

  console.log(`[Conversation] Loaded Meeting Guide Block (${meetingGuideBlock.length} chars), Exemplars (${meetingGuideExemplars.length} chars), DTW Org Layer (${dtwOrgLayer.length} chars)`);

  const meetingGuidePrompt = buildMeetingGuidePrompt(
    donorName,
    finalProfile,
    meetingGuideBlock,
    dtwOrgLayer,
    meetingGuideExemplars
  );

  const meetingGuideTokenEstimate = estimateTokens(meetingGuidePrompt);
  console.log(`[Conversation] Meeting guide prompt token estimate: ${meetingGuideTokenEstimate}`);

  // Token ratio check
  const voiceTokens = Math.round(meetingGuideBlock.length / 4);
  const exemplarTokens = Math.round(meetingGuideExemplars.length / 4);
  const inputTokens = Math.round(finalProfile.length / 4);
  console.log(`[Meeting Guide] Token ratio check:`);
  console.log(`  Voice + Exemplars: ~${voiceTokens + exemplarTokens} tokens`);
  console.log(`  Input (profile): ~${inputTokens} tokens`);
  console.log(`  Ratio healthy: ${(voiceTokens + exemplarTokens) >= inputTokens}`);
  if (inputTokens > 10000) {
    console.warn(`[Meeting Guide] WARNING: Profile exceeds 10,000 tokens (~${inputTokens})`);
  }

  // Save meeting guide prompt for debugging
  try {
    writeFileSync('/tmp/prospectai-outputs/DEBUG-meeting-guide-prompt.txt', meetingGuidePrompt);
    console.log(`[DEBUG] Meeting guide prompt saved (${meetingGuidePrompt.length} chars)`);
  } catch (e) { console.warn('[DEBUG] Failed to save meeting guide prompt:', e); }

  onProgress(`Writing tactical meeting guide for ${donorName}`, 'writing', 34, TOTAL_STEPS);

  const meetingGuideMessages: Message[] = [{ role: 'user', content: meetingGuidePrompt }];
  const mgPromise = conversationTurn(meetingGuideMessages, { maxTokens: 8000 });

  // Timed intermediate updates during meeting guide generation
  let meetingGuideDone = false;
  const mgTimers = [
    setTimeout(() => { if (!meetingGuideDone) onProgress('Crafting opening moves and positioning strategy', 'writing', 35, TOTAL_STEPS); }, 15000),
    setTimeout(() => { if (!meetingGuideDone) onProgress('Designing conversation flow and ask choreography', 'writing', 36, TOTAL_STEPS); }, 30000),
  ];

  const meetingGuide = await mgPromise;
  meetingGuideDone = true;
  mgTimers.forEach(clearTimeout);

  onProgress('✓ Meeting guide complete', 'writing', 37, TOTAL_STEPS);
  console.log(`[Conversation] Meeting guide complete: ${meetingGuide.length} chars`);

  // Save meeting guide markdown
  try {
    writeFileSync('/tmp/prospectai-outputs/DEBUG-meeting-guide.md', meetingGuide);
  } catch (e) { console.warn('[DEBUG] Failed to save meeting guide markdown:', e); }

  // Format meeting guide to HTML — embeddable for frontend, full doc for debug file
  const meetingGuideHtml = formatMeetingGuideEmbeddable(meetingGuide);
  const meetingGuideHtmlFull = formatMeetingGuide(meetingGuide);
  try {
    writeFileSync('/tmp/prospectai-outputs/DEBUG-meeting-guide.html', meetingGuideHtmlFull);
    console.log(`[Meeting Guide] HTML formatted: ${meetingGuideHtml.length} chars (embeddable), ${meetingGuideHtmlFull.length} chars (full)`);
  } catch (e) { console.warn('[DEBUG] Failed to save meeting guide HTML:', e); }

  // Validation
  const hasAllSections = meetingGuideHtml.includes('donor-read') &&
                         meetingGuideHtml.includes('alignment-map') &&
                         meetingGuideHtml.includes('beat-number');
  const beatCount = (meetingGuideHtml.match(/beat-number/g) || []).length;
  const signalCount = (meetingGuideHtml.match(/signal-tag/g) || []).length;
  console.log(`[Meeting Guide] Validation:`);
  console.log(`  All major sections: ${hasAllSections}`);
  console.log(`  Beats: ${beatCount}`);
  console.log(`  Signals: ${signalCount}`);

  onProgress('✓ All documents ready — preparing download', undefined, 38, TOTAL_STEPS);

  console.log(`${'='.repeat(60)}`);
  console.log(`CONVERSATION MODE: Complete`);
  console.log(`${'='.repeat(60)}\n`);

  return {
    research,
    profile: finalProfile,              // Persuasion Profile (18-section, user-facing)
    dossier: finalProfile,              // Frontend reads dossier.rawMarkdown for display
    meetingGuide,
    meetingGuideHtml,                   // Styled HTML version of meeting guide
    draft: extractionOutput,            // Extraction output (intermediate, for debug)
    critique: ''
  };
}
