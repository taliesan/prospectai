// Core pipeline for donor profiling
// This orchestrates the three steps: Research → Dossier → Profile

import { complete, completeExtended } from './anthropic';
import { sanitizeForClaude } from './sanitize';
import {
  IDENTITY_RESOLUTION_PROMPT,
  generateResearchQueries,
  SOURCE_CLASSIFICATION_PROMPT
} from './prompts/research';
import {
  createExtractionPrompt,
  createBatchExtractionPrompt,
  SYNTHESIS_PROMPT,
  CROSS_CUTTING_PROMPT,
  DIMENSIONS
} from './prompts/extraction';
import {
  createProfilePrompt,
  createRegenerationPrompt
} from './prompts/profile';
import { runAllValidators } from './validators';
import { PROFILE_QUALITY_CHECKLIST, selectExemplars } from './canon/loader';

// Types
interface ResearchResult {
  donorName: string;
  identity: any;
  queries: { query: string; category: string }[];
  sources: { url: string; title: string; snippet: string; content?: string }[];
  rawMarkdown: string;
}

interface DossierResult {
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

// Step 1: Research
export async function conductResearch(
  donorName: string,
  seedUrls: string[] = [],
  searchFunction: (query: string) => Promise<{ url: string; title: string; snippet: string }[]>
): Promise<ResearchResult> {
  console.log(`[Research] Starting research for: ${donorName}`);
  
  // 1. Resolve identity
  console.log('[Research] Resolving identity...');
  const identityPrompt = `${IDENTITY_RESOLUTION_PROMPT}

Donor Name: ${donorName}
Seed URLs: ${seedUrls.join(', ') || 'None provided'}

Resolve the identity of this donor.`;

  const identityResponse = await complete('You are a research assistant.', identityPrompt);
  
  let identity;
  try {
    // Extract JSON from response
    const jsonMatch = identityResponse.match(/\{[\s\S]*\}/);
    identity = jsonMatch ? JSON.parse(jsonMatch[0]) : { name: donorName, organizations: [], domainKeywords: [] };
  } catch {
    identity = { name: donorName, organizations: [], domainKeywords: [] };
  }
  
  console.log(`[Research] Identity resolved: ${identity.name}`);
  
  // 2. Generate search queries
  console.log('[Research] Generating search queries...');
  const queryPrompt = generateResearchQueries(donorName, identity);
  const queryResponse = await complete('You are a research strategist.', queryPrompt);
  
  let queries: { query: string; category: string }[] = [];
  try {
    const jsonMatch = queryResponse.match(/\[[\s\S]*\]/);
    queries = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch {
    // Fallback queries
    queries = [
      { query: `"${donorName}" biography`, category: 'BIOGRAPHY' },
      { query: `"${donorName}" interview`, category: 'INTERVIEWS' },
      { query: `"${donorName}" philanthropy`, category: 'PHILANTHROPY' },
      { query: `"${donorName}" podcast`, category: 'INTERVIEWS' },
    ];
  }
  
  console.log(`[Research] Generated ${queries.length} queries`);
  
  // 3. Execute searches
  console.log('[Research] Executing searches...');
  const allSources: { url: string; title: string; snippet: string; query: string }[] = [];
  
  for (const q of queries) {
    try {
      const results = await searchFunction(q.query);
      for (const r of results) {
        allSources.push({ ...r, query: q.query });
      }
    } catch (err) {
      console.error(`[Research] Search failed for: ${q.query}`, err);
    }
  }
  
  // Deduplicate by URL
  const uniqueSources = Array.from(
    new Map(allSources.map(s => [s.url, s])).values()
  );
  
  console.log(`[Research] Collected ${uniqueSources.length} unique sources`);
  
  // 4. Generate raw research document
  const rawMarkdown = generateResearchMarkdown(donorName, identity, queries, uniqueSources);
  
  return {
    donorName,
    identity,
    queries,
    sources: uniqueSources,
    rawMarkdown
  };
}

function generateResearchMarkdown(
  donorName: string,
  identity: any,
  queries: { query: string; category: string }[],
  sources: { url: string; title: string; snippet: string }[]
): string {
  const sections = [
    `# RAW RESEARCH: ${donorName}`,
    `Generated: ${new Date().toISOString()}`,
    `Sources: ${sources.length}`,
    '',
    '## Identity Resolution',
    '```json',
    JSON.stringify(identity, null, 2),
    '```',
    '',
    '## Search Queries',
    ...queries.map(q => `- [${q.category}] ${q.query}`),
    '',
    '## Sources',
    ...sources.map((s, i) => [
      `### ${i + 1}. ${s.title}`,
      `URL: ${s.url}`,
      `Snippet: ${s.snippet}`,
      ''
    ].join('\n'))
  ];
  
  return sections.join('\n');
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

// Source ranking by behavioral signal value
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

function rankAndSortSources(
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

// Step 2: Dossier Extraction
export async function extractDossier(
  donorName: string,
  sources: { url: string; title: string; snippet: string; content?: string }[],
  canonDocs: { exemplars: string }
): Promise<DossierResult> {
  console.log(`[Dossier] Starting extraction for: ${donorName}`);
  console.log(`[Dossier] Total sources available: ${sources.length}`);

  // Rank sources by behavioral signal value before processing
  const rankedSources = rankAndSortSources(sources);

  // Log tier distribution
  const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const s of rankedSources) {
    tierCounts[s.tier as keyof typeof tierCounts]++;
  }
  console.log(`[Dossier] Source tiers: T1(interviews/personal)=${tierCounts[1]}, T2(speeches/profiles)=${tierCounts[2]}, T3(news)=${tierCounts[3]}, T4(bio/wiki)=${tierCounts[4]}`);

  // Cap at 50 sources maximum to prevent timeouts and rate limits
  const MAX_SOURCES = 50;
  const sourcesToProcess = rankedSources.slice(0, MAX_SOURCES);
  console.log(`[Dossier] Processing top ${sourcesToProcess.length} sources (capped at ${MAX_SOURCES})`);

  // Filter sources with meaningful content
  const validSources = sourcesToProcess.filter(source =>
    source.content || source.snippet.length >= 100
  );
  const skipped = sourcesToProcess.length - validSources.length;
  console.log(`[Dossier] ${validSources.length} sources with content, ${skipped} skipped`);

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

    console.log(`[Dossier] Batch ${batchNumber}: Processing sources ${i + 1}-${batchEnd} of ${validSources.length}`);

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

        console.log(`[Dossier] Batch ${batchNumber}: ✓ Extracted ${parsedResults.length} sources`);
      } catch (parseErr) {
        // If JSON parsing fails, use raw response as single extraction
        console.warn(`[Dossier] Batch ${batchNumber}: JSON parse failed, using raw response`);
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
      console.error(`[Dossier] Batch ${batchNumber}: ✗ Failed: ${errorMessage.slice(0, 100)}`);
    }

    // Rate limiting: 3 second delay between batch API calls
    if (i + BATCH_SIZE < validSources.length) {
      await delay(3000);
    }
  }

  console.log(`[Dossier] Extraction complete: ${totalProcessed} processed in ${batchNumber} batches, ${failed} failed, ${skipped} skipped`);
  
  // 2. Synthesize by dimension
  console.log('[Dossier] Synthesizing dimensions...');
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
  console.log('[Dossier] Generating cross-cutting analysis...');
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
  
  // 4. Generate dossier document
  const rawMarkdown = generateDossierMarkdown(donorName, synthesis, crossCutting, allEvidence);
  
  return {
    donorName,
    dimensions: [], // Would parse synthesis into structured form
    crossCutting: {}, // Would parse cross-cutting into structured form
    rawMarkdown
  };
}

function generateDossierMarkdown(
  donorName: string,
  synthesis: string,
  crossCutting: string,
  evidence: any[]
): string {
  return `# BEHAVIORAL DOSSIER: ${donorName}

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
export async function generateProfile(
  donorName: string,
  dossier: string,
  canonDocs: { exemplars: string }
): Promise<ProfileResult> {
  console.log(`[Profile] Starting generation for: ${donorName}`);

  const exemplars = selectExemplars(dossier, canonDocs.exemplars);
  const systemPrompt = `You are a world-class donor profiler. Your profiles must be behavioral, specific, and actionable.

${PROFILE_QUALITY_CHECKLIST}`;

  // Initial generation
  console.log('[Profile] Generating initial draft...');
  const profilePrompt = createProfilePrompt(donorName, dossier, exemplars);
  let profile = await completeExtended(systemPrompt, profilePrompt, { maxTokens: 10000 });

  // Validation loop with 6 parallel validators
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[Profile] Validation attempt ${attempt}...`);

    // Run all 6 validators in parallel
    const validation = await runAllValidators(profile, dossier);

    if (validation.allPassed) {
      console.log('[Profile] All 6 validators PASSED');
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
    console.log(`[Profile] Failed validators: ${failedValidators.join(', ')}`);

    if (attempt < maxAttempts) {
      // Regenerate with specific feedback from all validators
      console.log('[Profile] Regenerating with validator feedback...');
      const regenPrompt = createRegenerationPrompt(
        donorName,
        dossier,
        exemplars,
        profile,
        validation.aggregatedFeedback
      );
      profile = await completeExtended(systemPrompt, regenPrompt, { maxTokens: 10000 });
    }
  }

  // Max attempts reached - run final validation to report what's still failing
  console.log('[Profile] Max attempts reached, checking final state...');
  const finalValidation = await runAllValidators(profile, dossier);
  const stillFailing = finalValidation.results
    .filter(r => !r.passed)
    .map(r => r.agent);

  console.log(`[Profile] Still failing: ${stillFailing.join(', ')}`);

  return {
    donorName,
    profile: profile + `\n\n---\n\n*Validation incomplete after 3 attempts. Still failing: ${stillFailing.join(', ')}*`,
    validationPasses: 0,
    status: 'validation_failed'
  };
}

// Full pipeline
export async function runFullPipeline(
  donorName: string,
  seedUrls: string[] = [],
  searchFunction: (query: string) => Promise<{ url: string; title: string; snippet: string }[]>,
  canonDocs: { exemplars: string }
): Promise<{
  research: ResearchResult;
  dossier: DossierResult;
  profile: ProfileResult;
}> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`PROSPECTAI: Processing ${donorName}`);
  console.log(`${'='.repeat(60)}\n`);
  
  // Step 1: Research
  const research = await conductResearch(donorName, seedUrls, searchFunction);
  console.log(`\n[Pipeline] Research complete: ${research.sources.length} sources\n`);
  
  // Step 2: Dossier
  const dossier = await extractDossier(donorName, research.sources, canonDocs);
  console.log(`\n[Pipeline] Dossier complete\n`);
  
  // Step 3: Profile
  const profile = await generateProfile(donorName, dossier.rawMarkdown, canonDocs);
  console.log(`\n[Pipeline] Profile complete: ${profile.status}\n`);
  
  console.log(`${'='.repeat(60)}`);
  console.log(`PROSPECTAI: Complete`);
  console.log(`${'='.repeat(60)}\n`);
  
  return { research, dossier, profile };
}
