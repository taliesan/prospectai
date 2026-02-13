/**
 * Conversation Pipeline Architecture (v8 — Single-Call Extraction)
 *
 * Stage 1: Source Discovery + Extraction
 *   Phase 1: Own Voice (Sonnet, agentic) — find everything the subject has written or said
 *   Phase 2: Pressure & Context (Sonnet, agentic) — external evidence, transitions, peer accounts
 *   Bulk Fetch: (coded) — parse URLs from Phase 1+2, fetch all pages in parallel
 *   Extraction: (Opus, single call) — read all source texts, produce 25-30K token research package
 *   - Output: research package (summary, evidence gaps, sources, 24-dim extraction)
 *
 * Stage 2: Profile Generation
 *   - Input: Geoffrey Block + exemplars + research package + output instructions
 *   - Output: First draft Persuasion Profile (18 sections)
 *
 * Stage 2b: Critique and Redraft Pass (if ENABLE_CRITIQUE_REDRAFT)
 *   - Input: Geoffrey Block + exemplars + research package + first draft
 *   - Process: score for insight novelty and tactical value, cut/compress
 *   - Output: Final Persuasion Profile (18 sections, user-facing)
 *
 * Stage 3: Meeting Guide Generation
 *   - Input: Final Persuasion Profile + Meeting Guide Block + MG Exemplars + DTW Org Layer
 *   - Output: Meeting Guide (tactical choreography, user-facing)
 *
 * Key terms:
 *   - "Research package" = extraction output with sources, evidence gaps, 24-dim extraction (~25-30K tokens)
 *   - "Persuasion Profile" = final 18-section output (user-facing)
 *
 * Cost per profile: ~$9-10
 *   - Tavily searches: ~$0.50-1.00
 *   - Extraction (Opus, single call): ~$4.50
 *   - Profile generation (Opus): ~$2.00
 *   - Editorial pass (Opus): ~$2.00
 */

import { conversationTurn, Message } from './anthropic';
import { loadExemplars, loadGeoffreyBlock, loadMeetingGuideBlock, loadMeetingGuideExemplars, loadDTWOrgLayer } from './canon/loader';
import { buildMeetingGuidePrompt } from './prompts/meeting-guide';
import { LinkedInData } from './prompts/extraction-prompt';
import { buildProfilePrompt } from './prompts/profile-prompt';
import { buildCritiqueRedraftPrompt } from './prompts/critique-redraft-prompt';
import { formatMeetingGuide, formatMeetingGuideEmbeddable } from './formatters/meeting-guide-formatter';
import { writeFileSync, mkdirSync } from 'fs';
import { runPhasedResearch } from './research/agent';

// STAGE 2b: Critique and Redraft Pass
// Set to false to revert to single-pass profile generation
// Added 2026-02-09 — if output quality degrades, set to false
const ENABLE_CRITIQUE_REDRAFT = true;

export interface ConversationResult {
  research: {
    donorName: string;
    researchPackage: string;
    searchCount: number;
    fetchCount: number;
    toolCallCount: number;
  };
  profile: string;
  researchPackage: string;      // Frontend reads this for display
  meetingGuide: string;
  meetingGuideHtml: string;
  draft: string;                // Research package (intermediate, for debug)
  critique: string;
}

// Re-export LinkedInData from canonical definition
export type { LinkedInData } from './prompts/extraction-prompt';

// Token estimation (rough: 4 chars per token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function parseLinkedInText(donorName: string, linkedinText: string): Promise<LinkedInData> {
  // Step 1: Coded regex extraction for structured fields (slug, websites)
  const codedFields = extractLinkedInCodedFields(linkedinText);
  console.log(`[LinkedIn] Coded extraction: slug=${codedFields.linkedinSlug || 'none'}, websites=${codedFields.websites.join(', ') || 'none'}`);

  // Step 2: LLM extraction for unstructured fields (career, education, boards)
  const parsePrompt = `Extract structured biographical data from this LinkedIn profile text.

Return JSON in this exact format:
{
  "currentTitle": "their current job title",
  "currentEmployer": "their current employer",
  "linkedinSlug": "the handle from their LinkedIn URL (e.g. 'geoffreymacdougall' from linkedin.com/in/geoffreymacdougall)",
  "websites": ["any personal websites listed, e.g. 'intangible.ca/about/', 'www.onepitch.org'"],
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
Look for the LinkedIn profile URL (linkedin.com/in/...) and any personal websites or URLs that are NOT linkedin.com.

LinkedIn Profile Text:
${linkedinText}`;

  const response = await conversationTurn([{ role: 'user', content: parsePrompt }], { maxTokens: 4000 });

  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse LinkedIn data');
  }

  const llmData: LinkedInData = JSON.parse(jsonMatch[0]);

  // Step 3: Merge — coded regex wins for slug and websites (more reliable)
  if (codedFields.linkedinSlug) {
    llmData.linkedinSlug = codedFields.linkedinSlug;
  }
  if (codedFields.websites.length > 0) {
    const allWebsites = new Set([...codedFields.websites, ...(llmData.websites || [])]);
    llmData.websites = Array.from(allWebsites);
  }

  return llmData;
}

/**
 * Extract LinkedIn slug and personal websites from raw PDF text using regex.
 * More reliable than LLM for these structured fields.
 */
function extractLinkedInCodedFields(pdfText: string): { linkedinSlug: string | null; websites: string[] } {
  let linkedinSlug: string | null = null;
  const websites: string[] = [];

  // Extract LinkedIn slug: linkedin.com/in/SLUG
  const slugMatch = pdfText.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/i);
  if (slugMatch) {
    linkedinSlug = slugMatch[1];
  }

  // Extract all URLs from the text
  const urlPattern = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(?:\/[^\s,)]*)?)/gi;
  let urlMatch;
  while ((urlMatch = urlPattern.exec(pdfText)) !== null) {
    const fullUrl = urlMatch[0];
    // Skip LinkedIn URLs, social media, and common non-personal domains
    if (/linkedin\.com|facebook\.com|twitter\.com|instagram\.com|github\.com|mailto:/i.test(fullUrl)) {
      continue;
    }
    websites.push(fullUrl.startsWith('http') ? fullUrl : `https://${fullUrl}`);
  }

  // Deduplicate websites by hostname
  const seenHosts = new Set<string>();
  const dedupedWebsites = websites.filter(url => {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      if (seenHosts.has(host)) return false;
      seenHosts.add(host);
      return true;
    } catch {
      return true;
    }
  });

  return { linkedinSlug, websites: dedupedWebsites };
}

// Progress callback type matching the new phase/step signature
type PipelineProgressCallback = (message: string, phase?: string, step?: number, totalSteps?: number) => void;

/**
 * Main conversation pipeline — see architecture comment at top of file.
 *
 * searchFunction and fetchFunction are accepted for backward compatibility
 * but are NOT used — the research agent handles search and fetch internally
 * via its own tool calls to Tavily.
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
  console.log(`CONVERSATION MODE (v8 single-call extraction): Processing ${donorName}`);
  console.log(`${'='.repeat(60)}\n`);

  const TOTAL_STEPS = 38;

  // ─── LinkedIn PDF Parsing (before research, so it informs the agent) ───
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

      onProgress(`LinkedIn parsed — ${linkedinData.currentTitle} at ${linkedinData.currentEmployer}`, undefined, 2, TOTAL_STEPS);
    } catch (err) {
      console.error('[LinkedIn] Parsing failed:', err);
      onProgress('LinkedIn PDF parsing failed — continuing without it', undefined, 2, TOTAL_STEPS);
    }
  } else {
    console.log('[LinkedIn] No PDF provided in request');
  }

  // ─── Stage 1: Phased Research ──────────────────────────────────────
  onProgress(`Building intelligence profile for ${donorName}`, undefined, 3, TOTAL_STEPS);
  onProgress('', 'research'); // phase transition event

  console.log(`[Pipeline] Starting phased research for ${donorName}...`);

  const phasedResult = await runPhasedResearch(linkedinData, donorName, onProgress);

  const { researchPackage, phase1Sources, phase2Sources, phase1, phase2, phase3 } = phasedResult;
  const { totalSearchCount: searchCount, totalFetchCount: fetchCount, totalToolCallCount: toolCallCount } = phasedResult;

  console.log(`[Pipeline] Phased research complete: ${searchCount} searches, ${fetchCount} page fetches across 3 phases`);
  console.log(`[Pipeline] Research package: ${researchPackage.length} chars`);

  onProgress(
    `Research complete — ${searchCount} searches, ${fetchCount} pages read across 3 phases`,
    'research', 15, TOTAL_STEPS
  );

  // [DEBUG] Save per-phase outputs
  try {
    mkdirSync('/tmp/prospectai-outputs', { recursive: true });

    // Phase 1 outputs
    writeFileSync('/tmp/prospectai-outputs/DEBUG-phase1-sources.txt', phase1Sources);
    writeFileSync('/tmp/prospectai-outputs/DEBUG-phase1-conversation.json', JSON.stringify(phase1.conversationLog, null, 2));
    console.log(`[DEBUG] Phase 1 saved: ${phase1Sources.length} chars, ${phase1.conversationLog.length} messages`);

    // Phase 2 outputs
    writeFileSync('/tmp/prospectai-outputs/DEBUG-phase2-sources.txt', phase2Sources);
    writeFileSync('/tmp/prospectai-outputs/DEBUG-phase2-conversation.json', JSON.stringify(phase2.conversationLog, null, 2));
    console.log(`[DEBUG] Phase 2 saved: ${phase2Sources.length} chars, ${phase2.conversationLog.length} messages`);

    // Phase 3 outputs (the research package)
    writeFileSync('/tmp/prospectai-outputs/DEBUG-phase3-research-package.txt', researchPackage);
    writeFileSync('/tmp/prospectai-outputs/DEBUG-phase3-conversation.json', JSON.stringify(phase3.conversationLog, null, 2));
    console.log(`[DEBUG] Phase 3 saved: ${researchPackage.length} chars, ${phase3.conversationLog.length} messages`);

    // Backward-compatible combined files
    writeFileSync('/tmp/prospectai-outputs/DEBUG-research-package.txt', researchPackage);
    writeFileSync('/tmp/prospectai-outputs/DEBUG-research-conversation.json', JSON.stringify(phase3.conversationLog, null, 2));
  } catch (e) { console.warn('[DEBUG] Failed to save research outputs:', e); }

  // ─── Stage 2: Profile Generation ────────────────────────────────────
  onProgress('', 'analysis'); // phase transition event
  onProgress('Writing Persuasion Profile from behavioral evidence', 'analysis', 22, TOTAL_STEPS);
  console.log('[Pipeline] Stage 2: Generating Persuasion Profile...');

  // Load canon documents
  const geoffreyBlock = loadGeoffreyBlock();
  const exemplars = loadExemplars();
  console.log(`[Pipeline] Loaded Geoffrey Block (${geoffreyBlock.length} chars) and exemplars (${exemplars.length} chars)`);

  // The research package IS the extraction output — it contains the 24-dimension evidence
  // Extraction entries are ~250 tokens each with long quotes, surrounding text, and source shape
  const researchPackagePreamble = `The behavioral evidence below was curated from ${fetchCount} source pages by an extraction model that read every source in full. Entries preserve the subject's original voice, surrounding context, and source shape. The Research Summary and Evidence Gaps sections describe what was found and what wasn't. Where evidence is thin, the profile should acknowledge limits rather than extrapolating from weak data.\n\n`;

  const extractionForProfile = researchPackagePreamble + researchPackage;

  const profilePromptText = buildProfilePrompt(donorName, extractionForProfile, geoffreyBlock, exemplars, linkedinData);
  const profileTokenEstimate = estimateTokens(profilePromptText);
  console.log(`[Pipeline] Profile prompt token estimate: ${profileTokenEstimate}`);

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

  console.log(`[Stage 2] Profile generation complete: ${firstDraftProfile.length} chars`);

  // Save first draft debug output (ALWAYS, regardless of flag)
  try {
    writeFileSync('/tmp/prospectai-outputs/DEBUG-profile-first-draft.txt', firstDraftProfile);
    console.log(`[DEBUG] First draft profile saved (${firstDraftProfile.length} chars)`);
  } catch (e) { console.warn('[DEBUG] Failed to save first draft:', e); }

  // ─── Stage 2b: Critique and Redraft Pass ─────────────────────────────
  // Revert by setting ENABLE_CRITIQUE_REDRAFT = false at top of file
  let finalProfile = firstDraftProfile;

  if (ENABLE_CRITIQUE_REDRAFT) {
    console.log(`[Stage 2b] Starting critique and redraft pass...`);
    onProgress('Scoring first draft against production standard...', 'analysis', 27, TOTAL_STEPS);

    const critiquePrompt = buildCritiqueRedraftPrompt(
      donorName,
      firstDraftProfile,
      geoffreyBlock,
      exemplars,
      researchPackage,    // Use research package as behavioral evidence for critique
      linkedinData
    );

    // Save critique prompt for debugging
    try {
      writeFileSync('/tmp/prospectai-outputs/DEBUG-critique-prompt.txt', critiquePrompt);
      console.log(`[DEBUG] Critique prompt saved (${critiquePrompt.length} chars)`);
    } catch (e) { console.warn('[DEBUG] Failed to save critique prompt:', e); }
    console.log(`[Stage 2b] Critique prompt token estimate: ${estimateTokens(critiquePrompt)}`);

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
    console.log(`[Stage 2b] Complete: ${firstDraftProfile.length} → ${finalProfile.length} chars (${reduction}% reduction)`);
    onProgress(`Editorial pass complete — ${reduction}% tighter`, 'analysis', 31, TOTAL_STEPS);
  } else {
    console.log(`[Stage 2b] Skipped (ENABLE_CRITIQUE_REDRAFT = false)`);
    onProgress(`Persuasion Profile complete — ${finalProfile.length} characters of insight`, 'analysis', 27, TOTAL_STEPS);
  }

  // ─── Stage 3: Meeting Guide Generation ──────────────────────────────
  onProgress('', 'writing'); // phase transition event
  onProgress('Loading meeting strategy framework', 'writing', 33, TOTAL_STEPS);
  console.log('[Pipeline] Stage 3: Generating meeting guide from profile...');

  const meetingGuideBlock = loadMeetingGuideBlock();
  const meetingGuideExemplars = loadMeetingGuideExemplars();
  const dtwOrgLayer = loadDTWOrgLayer();

  console.log(`[Pipeline] Loaded Meeting Guide Block (${meetingGuideBlock.length} chars), Exemplars (${meetingGuideExemplars.length} chars), DTW Org Layer (${dtwOrgLayer.length} chars)`);

  const meetingGuidePrompt = buildMeetingGuidePrompt(
    donorName,
    finalProfile,
    meetingGuideBlock,
    dtwOrgLayer,
    meetingGuideExemplars
  );

  const meetingGuideTokenEstimate = estimateTokens(meetingGuidePrompt);
  console.log(`[Pipeline] Meeting guide prompt token estimate: ${meetingGuideTokenEstimate}`);

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

  onProgress('Meeting guide complete', 'writing', 37, TOTAL_STEPS);
  console.log(`[Pipeline] Meeting guide complete: ${meetingGuide.length} chars`);

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

  onProgress('All documents ready — preparing download', undefined, 38, TOTAL_STEPS);

  console.log(`${'='.repeat(60)}`);
  console.log(`CONVERSATION MODE: Complete`);
  console.log(`${'='.repeat(60)}\n`);

  return {
    research: {
      donorName,
      researchPackage,
      searchCount,
      fetchCount,
      toolCallCount,
    },
    profile: finalProfile,              // Persuasion Profile (18-section, user-facing)
    researchPackage: finalProfile,      // Frontend reads this for display
    meetingGuide,
    meetingGuideHtml,                   // Styled HTML version of meeting guide
    draft: researchPackage,             // Research package (intermediate, for debug)
    critique: ''
  };
}
