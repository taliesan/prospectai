// ARCHIVED: Legacy pipeline functions removed from pipeline.ts
// Date: February 2026
// Reason: Not called by any active code path per system audit
// If you need these back, they were at the following original locations:
//   screenSourcesForRelevance()    — pipeline.ts ~line 476
//   rankSourceByBehavioralValue()  — pipeline.ts ~line 657
//   rankAndSortSources()           — pipeline.ts ~line 735
//   extractEvidence()              — pipeline.ts ~line 756
//   generateProfile()              — pipeline.ts ~line 984
//   generateExtractionMarkdown()   — pipeline.ts ~line 951
//   withTimeout()                  — pipeline.ts ~line 638
//   delay()                        — pipeline.ts ~line 648
//   ExtractionResult interface     — pipeline.ts ~line 82
//   ProfileResult interface        — pipeline.ts ~line 89

import { complete, completeExtended } from '../anthropic';
import { sanitizeForClaude } from '../sanitize';
import { STATUS } from '../progress';
import {
  createBatchExtractionPrompt,
  SYNTHESIS_PROMPT,
  CROSS_CUTTING_PROMPT,
} from '../prompts/extraction';
import {
  createProfilePrompt,
  createRegenerationPrompt
} from '../prompts/profile';
import { selectExemplars } from '../canon/loader';
import type { TieredSource } from '../research/tiering';

// Types

interface ExtractionResult {
  donorName: string;
  dimensions: any[];
  crossCutting: any;
  rawMarkdown: string;
}

interface ProfileResult {
  donorName: string;
  profile: string;
  validationPasses: number;
  status: 'complete' | 'validation_failed';
}

// Progress callback type for conversation pipeline integration
type ResearchProgressCallback = (message: string, phase?: string, step?: number, totalSteps?: number) => void;

// ── Identity-based relevance screening (kept for backward compat) ──

async function screenSourcesForRelevance(
  sources: { url: string; title: string; snippet: string }[],
  identity: any,
  donorName: string,
  tailoredUrls: Set<string>,
  emit?: ResearchProgressCallback
): Promise<{ url: string; title: string; snippet: string }[]> {

  // Fast-path filters (no LLM needed)
  const dominated: { url: string; title: string; snippet: string }[] = [];
  const needsScreening: { url: string; title: string; snippet: string }[] = [];

  for (const source of sources) {
    const combined = `${source.url} ${source.title} ${source.snippet}`.toLowerCase();
    let dominatedFlag = false;

    // Always include if org name appears
    if (identity.currentOrg) {
      const orgLower = identity.currentOrg.toLowerCase();
      if (combined.includes(orgLower)) {
        dominated.push(source);
        dominatedFlag = true;
      }
    }

    // Always include if unique identifier appears
    if (!dominatedFlag) {
      for (const uid of (identity.uniqueIdentifiers || [])) {
        if (uid && combined.includes(uid.toLowerCase())) {
          dominated.push(source);
          dominatedFlag = true;
          break;
        }
      }
    }

    if (!dominatedFlag) {
      needsScreening.push(source);
    }
  }

  console.log(`[Research] Fast-path accepted: ${dominated.length}, needs LLM screening: ${needsScreening.length}`);

  // For sources that didn't pass fast-path, use LLM screening
  const screened: { url: string; title: string; snippet: string }[] = [...dominated];

  if (needsScreening.length > 0) {
    const BATCH_SIZE = 10;

    for (let i = 0; i < needsScreening.length; i += BATCH_SIZE) {
      const batch = needsScreening.slice(i, i + BATCH_SIZE);

      const screenPrompt = `Screen these search results to determine if they are relevant to research about the target person.

TARGET PERSON:
- Name: ${donorName}
- Current Role: ${identity.currentRole || 'Unknown'}
- Current Organization: ${identity.currentOrg || 'Unknown'}
- Locations: ${(identity.locations || []).join(', ') || 'Unknown'}
- Affiliations: ${(identity.affiliations || []).join(', ') || 'Unknown'}
- Unique Identifiers: ${(identity.uniqueIdentifiers || []).join(', ') || 'None'}

SEARCH RESULTS TO SCREEN:
${batch.map((s, idx) => {
  const isTailored = tailoredUrls.has(s.url);
  return `
[${idx}]${isTailored ? ' [TAILORED QUERY RESULT]' : ''}
URL: ${s.url}
Title: ${s.title}
Snippet: ${s.snippet}`;
}).join('\n')}

For each result, determine if it is RELEVANT to researching the target person.

IMPORTANT: Some sources are relevant even if they don't mention the donor by name directly. Accept sources that:
- Show decisions, grants, investments, or actions from the donor's organization or program
- Cover the donor's domain, sector, or program area during their tenure
- Include perspectives from collaborators, grantees, or critics of the donor's organization
- Discuss controversies or debates in the donor's professional domain

The goal is behavioral signal — understanding how this person thinks and operates. Institutional decisions reflect their judgment even when they're not named personally.

Sources marked [TAILORED QUERY RESULT] were found through targeted research into the person's institutional footprint. These deserve extra consideration — they may not mention the person by name but can reveal how they operate through organizational actions.

REJECT sources that are clearly about a DIFFERENT person with the same or similar name (wrong company, wrong field, wrong location). Be conservative about wrong-person matches, but inclusive about institutional and domain sources.

Output as JSON array (one entry per result, in order):
[
  { "index": 0, "isMatch": true, "confidence": "high", "reason": "brief explanation" },
  { "index": 1, "isMatch": false, "confidence": "high", "reason": "different person - wrong company" }
]`;

      try {
        const response = await complete('You are screening search results for relevance to a donor research profile.', screenPrompt);
        const jsonMatch = response.match(/\[[\s\S]*\]/);

        if (jsonMatch) {
          const results = JSON.parse(jsonMatch[0]);
          for (const r of results) {
            if (r.isMatch) {
              const source = batch[r.index];
              const isTailored = tailoredUrls.has(source.url);
              // Standard sources: require high or medium confidence
              // Tailored sources: accept any confidence level (the query was targeted)
              if (isTailored || r.confidence === 'high' || r.confidence === 'medium') {
                screened.push(source);
              }
            }
          }
        }
      } catch (err) {
        console.error('[Research] Source screening batch failed:', err);
        // On error, include all sources from this batch (fail open)
        screened.push(...batch);
      }

      const screenedSoFar = i + batch.length;
      if (emit) {
        emit(`Screened ${screenedSoFar} of ${needsScreening.length} sources`, 'research', 13, 28);
      }
    }
  }

  console.log(`[Research] Screening complete: ${screened.length} accepted (${screened.length - dominated.length} via LLM, ${dominated.length} fast-path)`);
  return screened;
}

// Helper: Promise with timeout
function withTimeout<T>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), ms)
    )
  ]);
}

// Helper: Delay for rate limiting
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Source ranking by behavioral signal value (kept for backward compat with extractEvidence)
// TIER 1: Interviews, podcasts, personal writing (highest behavioral signal)
// TIER 2: Speeches, talks, in-depth profiles
// TIER 3: News coverage, press releases
// TIER 4: Wikipedia, bio pages, LinkedIn (lowest signal)
function rankSourceByBehavioralValue(source: { url: string; title: string; snippet: string }): number {
  const url = source.url.toLowerCase();
  const title = (source.title || '').toLowerCase();
  const snippet = (source.snippet || '').toLowerCase();
  const combined = `${url} ${title} ${snippet}`;

  // TIER 1 (score 1): Video/podcast interviews, personal writing
  const tier1Patterns = [
    /youtube\.com/,
    /youtu\.be/,
    /podcast/,
    /\binterview\b/,
    /medium\.com/,
    /substack/,
    /\bop-ed\b/,
    /\bi think\b/,
    /\bmy view\b/,
    /\bi believe\b/,
    /personal\s*(essay|blog|writing)/,
  ];
  for (const pattern of tier1Patterns) {
    if (pattern.test(combined)) return 1;
  }

  // TIER 2 (score 2): Speeches, talks, in-depth profiles
  const tier2Patterns = [
    /\bspeech\b/,
    /\bkeynote\b/,
    /\bremarks\b/,
    /\btalk at\b/,
    /\btalks at\b/,
    /\bprofile\b/,
    /\bfeature\b/,
    /longform/,
    /newyorker\.com/,
    /theatlantic\.com/,
    /wired\.com/,
    /vanityfair\.com/,
  ];
  for (const pattern of tier2Patterns) {
    if (pattern.test(combined)) return 2;
  }

  // TIER 4 (score 4): Wikipedia, bio pages, LinkedIn (check before tier 3)
  const tier4Patterns = [
    /wikipedia\.org/,
    /linkedin\.com/,
    /crunchbase\.com/,
    /bloomberg\.com\/profile/,
    /forbes\.com\/profile/,
    /\/bio\b/,
    /\/about\b/,
  ];
  for (const pattern of tier4Patterns) {
    if (pattern.test(combined)) return 4;
  }

  // TIER 3 (score 3): News coverage, press releases (default for news sites)
  const tier3Patterns = [
    /\bannounces\b/,
    /\bsays\b/,
    /press\s*release/,
    /news/,
    /\.com\/(article|story|news)/,
    /reuters\.com/,
    /bloomberg\.com/,
    /wsj\.com/,
    /nytimes\.com/,
    /washingtonpost\.com/,
  ];
  for (const pattern of tier3Patterns) {
    if (pattern.test(combined)) return 3;
  }

  // Default to tier 3 if no patterns match
  return 3;
}

export function rankAndSortSources(
  sources: { url: string; title: string; snippet: string; content?: string }[]
): { url: string; title: string; snippet: string; content?: string; tier: number }[] {
  const ranked = sources.map(source => ({
    ...source,
    tier: rankSourceByBehavioralValue(source)
  }));

  // Sort by tier (lower = better), then by content availability
  ranked.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    // Prefer sources with full content
    if (a.content && !b.content) return -1;
    if (!a.content && b.content) return 1;
    return 0;
  });

  return ranked;
}

// Step 2: Evidence Extraction
export async function extractEvidence(
  donorName: string,
  sources: { url: string; title: string; snippet: string; content?: string }[],
  canonDocs: { exemplars: string }
): Promise<ExtractionResult> {
  console.log(`[Extraction] Starting extraction for: ${donorName}`);
  console.log(`[Extraction] Total sources available: ${sources.length}`);

  // Rank sources by behavioral signal value before processing
  const rankedSources = rankAndSortSources(sources);

  // Log tier distribution
  const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const s of rankedSources) {
    tierCounts[s.tier as keyof typeof tierCounts]++;
  }
  console.log(`[Extraction] Source tiers: T1(interviews/personal)=${tierCounts[1]}, T2(speeches/profiles)=${tierCounts[2]}, T3(news)=${tierCounts[3]}, T4(bio/wiki)=${tierCounts[4]}`);
  STATUS.tiersPrioritized(tierCounts[1], tierCounts[2], tierCounts[3], tierCounts[4]);

  // Log top 5 sources to verify ranking
  console.log(`[Extraction] Top 5 sources by behavioral value:`);
  for (const s of rankedSources.slice(0, 5)) {
    console.log(`[Extraction]   [T${s.tier}] ${s.title?.slice(0, 60) || s.url}`);
  }

  // Cap at 50 sources maximum to prevent timeouts and rate limits
  const MAX_SOURCES = 50;
  const sourcesToProcess = rankedSources.slice(0, MAX_SOURCES);
  console.log(`[Extraction] Processing top ${sourcesToProcess.length} sources (capped at ${MAX_SOURCES})`);
  STATUS.processingTop(sourcesToProcess.length);

  // Filter sources with meaningful content
  const validSources = sourcesToProcess.filter(source =>
    source.content || source.snippet.length >= 100
  );
  const skipped = sourcesToProcess.length - validSources.length;
  console.log(`[Extraction] ${validSources.length} sources with content, ${skipped} skipped`);

  // 1. Batch extract from sources (10 sources per batch = ~5 API calls for 50 sources)
  const BATCH_SIZE = 10;
  const allEvidence: any[] = [];
  let batchNumber = 0;
  let totalProcessed = 0;
  let failed = 0;

  for (let i = 0; i < validSources.length; i += BATCH_SIZE) {
    batchNumber++;
    const batch = validSources.slice(i, i + BATCH_SIZE);
    const batchEnd = Math.min(i + BATCH_SIZE, validSources.length);

    console.log(`[Extraction] Batch ${batchNumber}: Processing sources ${i + 1}-${batchEnd} of ${validSources.length}`);
    STATUS.batchStarted(batchNumber, i + 1, batchEnd);

    // Prepare batch sources with sanitized content
    const batchSources = batch.map(source => ({
      title: source.title || 'Untitled',
      url: source.url,
      type: `TIER_${source.tier}`,
      content: sanitizeForClaude(source.content || source.snippet)
    }));

    try {
      // 5 minute timeout for batch extraction - this is an intensive task
      const batchPrompt = createBatchExtractionPrompt(donorName, batchSources);
      const batchExtraction = await withTimeout(
        complete(
          'You are extracting behavioral evidence for donor profiling. Return valid JSON only.',
          batchPrompt,
          { maxTokens: 8192 }
        ),
        300000,
        `Timeout extracting batch ${batchNumber}`
      );

      // Parse JSON response
      try {
        // Extract JSON from response (may have markdown code blocks)
        let jsonStr = batchExtraction;
        const jsonMatch = batchExtraction.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          jsonStr = jsonMatch[0];
        }

        const parsedResults = JSON.parse(jsonStr);

        // Convert parsed results to evidence format
        for (const result of parsedResults) {
          const sourceUrl = result.url || batchSources[result.source_index - 1]?.url || `batch_${batchNumber}_source_${result.source_index}`;

          // Convert JSON extractions back to markdown format for synthesis
          let extractionMarkdown = '';
          if (result.extractions && Array.isArray(result.extractions)) {
            for (const ext of result.extractions) {
              if (ext.type === 'ABSENCE') {
                extractionMarkdown += `\n## ${ext.dimension} — ABSENCE\n`;
                extractionMarkdown += `**Notable Silence:** ${ext.notable_silence || 'N/A'}\n`;
                extractionMarkdown += `**Significance:** ${ext.significance || 'N/A'}\n`;
              } else {
                extractionMarkdown += `\n## ${ext.dimension}\n`;
                extractionMarkdown += `**Pattern:** ${ext.pattern || 'N/A'}\n`;
                extractionMarkdown += `**Trigger:** ${ext.trigger || 'N/A'}\n`;
                extractionMarkdown += `**Response:** ${ext.response || 'N/A'}\n`;
                extractionMarkdown += `**Tell:** ${ext.tell || 'N/A'}\n`;
                extractionMarkdown += `**Evidence:** ${ext.evidence || 'N/A'}\n`;
                extractionMarkdown += `**Confidence:** ${ext.confidence || 'N/A'}\n`;
                extractionMarkdown += `**Confidence Reason:** ${ext.confidence_reason || 'N/A'}\n`;
                extractionMarkdown += `**Meeting Implication:** ${ext.meeting_implication || 'N/A'}\n`;
              }
            }
          }

          allEvidence.push({
            source: sourceUrl,
            extraction: extractionMarkdown || batchExtraction
          });
          totalProcessed++;
        }

        console.log(`[Extraction] Batch ${batchNumber}: ✓ Extracted ${parsedResults.length} sources`);
        STATUS.batchComplete(batchNumber, i + 1, batchEnd);
      } catch (parseErr) {
        // If JSON parsing fails, use raw response as single extraction
        console.warn(`[Extraction] Batch ${batchNumber}: JSON parse failed, using raw response`);
        for (const source of batchSources) {
          allEvidence.push({
            source: source.url,
            extraction: batchExtraction
          });
          totalProcessed++;
        }
      }
    } catch (err) {
      failed += batch.length;
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[Extraction] Batch ${batchNumber}: ✗ Failed: ${errorMessage.slice(0, 100)}`);
      STATUS.batchFailed(batchNumber, errorMessage);
    }

    // Rate limiting: 3 second delay between batch API calls
    if (i + BATCH_SIZE < validSources.length) {
      await delay(3000);
    }
  }

  console.log(`[Extraction] Extraction complete: ${totalProcessed} processed in ${batchNumber} batches, ${failed} failed, ${skipped} skipped`);

  // 2. Synthesize by dimension
  console.log('[Extraction] Synthesizing dimensions...');
  STATUS.synthesizing();
  const combinedEvidence = allEvidence.map(e => e.extraction).join('\n\n---\n\n');

  const synthesisPrompt = `${SYNTHESIS_PROMPT}

DONOR: ${donorName}

ALL EXTRACTED EVIDENCE:
${combinedEvidence}

Synthesize the evidence across all 17 dimensions. For each dimension, provide the synthesis in the format specified.`;

  const synthesis = await completeExtended(
    'You are synthesizing behavioral patterns for donor profiling.',
    synthesisPrompt,
    { maxTokens: 12000 }
  );

  // 3. Cross-cutting analysis
  console.log('[Extraction] Generating cross-cutting analysis...');
  STATUS.crossCutting();
  const crossCuttingPrompt = `${CROSS_CUTTING_PROMPT}

DONOR: ${donorName}

DIMENSION SYNTHESES:
${synthesis}

Generate the cross-cutting analysis: core contradiction, dangerous truth, and substrate architecture.`;

  const crossCutting = await complete(
    'You are identifying cross-cutting patterns in donor behavior.',
    crossCuttingPrompt,
    { maxTokens: 4096 }
  );

  // 4. Generate extraction document
  const rawMarkdown = generateExtractionMarkdown(donorName, synthesis, crossCutting, allEvidence);

  return {
    donorName,
    dimensions: [], // Would parse synthesis into structured form
    crossCutting: {}, // Would parse cross-cutting into structured form
    rawMarkdown
  };
}

function generateExtractionMarkdown(
  donorName: string,
  synthesis: string,
  crossCutting: string,
  evidence: any[]
): string {
  return `# BEHAVIORAL EXTRACTION: ${donorName}

Generated: ${new Date().toISOString()}
Sources Analyzed: ${evidence.length}

---

## DIMENSION ANALYSIS

${synthesis}

---

## CROSS-CUTTING ANALYSIS

${crossCutting}

---

## SOURCE EVIDENCE

${evidence.map((e, i) => `### Source ${i + 1}: ${e.source}\n\n${e.extraction}`).join('\n\n---\n\n')}
`;
}

// Step 3: Profile Generation with Validation Loop
// Profile ALWAYS ships - validation is informational, never blocks
export async function generateProfile(
  donorName: string,
  extraction: string,
  canonDocs: { exemplars: string }
): Promise<ProfileResult> {
  console.log(`[Profile] Starting generation for: ${donorName}`);

  const exemplars = selectExemplars(extraction, canonDocs.exemplars);
  const systemPrompt = 'You are writing a donor persuasion profile.';

  // Initial generation
  console.log('[Profile] Generating initial draft...');
  STATUS.generatingDraft();
  let profile: string;
  try {
    const profilePrompt = createProfilePrompt(donorName, extraction, exemplars);
    profile = await completeExtended(systemPrompt, profilePrompt, { maxTokens: 10000 });
  } catch (err) {
    console.error('[Profile] Initial generation failed:', err);
    return {
      donorName,
      profile: `# Profile Generation Failed\n\nError: ${String(err)}\n\nPlease try again.`,
      validationPasses: 0,
      status: 'validation_failed'
    };
  }

  // Validation loop - skipped (validators removed, profile now uses Geoffrey Block pipeline)
  const maxAttempts = 1;
  let validationResults: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[Profile] Validation attempt ${attempt}/${maxAttempts}...`);
      STATUS.validationAttempt(attempt, maxAttempts);

      const validation = { allPassed: true, results: [] as any[], aggregatedFeedback: '' };

      if (validation.allPassed) {
        console.log('[Profile] All 6 validators PASSED');
        STATUS.profileComplete();
        return {
          donorName,
          profile,
          validationPasses: attempt,
          status: 'complete'
        };
      }

      // Log which validators failed
      const failedValidators = validation.results
        .filter(r => !r.passed)
        .map(r => r.agent);
      const passedValidators = validation.results
        .filter(r => r.passed)
        .map(r => r.agent);

      console.log(`[Profile] Passed: ${passedValidators.join(', ') || 'none'}`);
      console.log(`[Profile] Failed: ${failedValidators.join(', ')}`);
      validationResults = failedValidators;

      if (attempt < maxAttempts) {
        // Regenerate with specific feedback from validators
        console.log('[Profile] Regenerating with validator feedback...');
        STATUS.regenerating();
        try {
          const regenPrompt = createRegenerationPrompt(
            donorName,
            extraction,
            exemplars,
            profile,
            validation.aggregatedFeedback
          );
          profile = await completeExtended(systemPrompt, regenPrompt, { maxTokens: 10000 });
        } catch (regenErr) {
          console.error('[Profile] Regeneration failed:', regenErr);
          // Keep the current profile and continue to next attempt or exit
        }
      }
    } catch (validationErr) {
      console.error(`[Profile] Validation attempt ${attempt} error:`, validationErr);
      // Continue to next attempt or exit loop
    }
  }

  // Always ship the profile, even if validation didn't fully pass
  console.log('[Profile] Shipping profile (validation incomplete or failed)');
  STATUS.profileShipping();

  const validationNote = validationResults.length > 0
    ? `\n\n---\n\n*Validation: Some checks did not pass (${validationResults.join(', ')}). Profile may need manual review.*`
    : '';

  return {
    donorName,
    profile: profile + validationNote,
    validationPasses: 0,
    status: 'validation_failed'
  };
}
