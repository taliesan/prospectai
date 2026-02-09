// Core pipeline for donor profiling
// This orchestrates the three steps: Research → Dossier → Profile

import { complete, completeExtended } from './anthropic';
import { sanitizeForClaude } from './sanitize';
import { STATUS } from './progress';
import {
  IDENTITY_EXTRACTION_PROMPT,
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
import { selectExemplars } from './canon/loader';

// Types
interface GeneratedQuery {
  query: string;
  tier: 'STANDARD' | 'TAILORED';
  rationale: string;
}

interface ResearchResult {
  donorName: string;
  identity: any;
  queries: GeneratedQuery[];
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

// Progress callback type for conversation pipeline integration
type ResearchProgressCallback = (message: string, phase?: string, step?: number, totalSteps?: number) => void;

// Step 1: Research
export async function conductResearch(
  donorName: string,
  seedUrls: string[] = [],
  searchFunction: (query: string) => Promise<{ url: string; title: string; snippet: string }[]>,
  fetchFunction?: (url: string) => Promise<string>,
  onProgress?: ResearchProgressCallback
): Promise<ResearchResult> {
  console.log(`[Research] Starting research for: ${donorName}`);
  const emit = onProgress || (() => {});
  const TOTAL = 28;

  // 1. Fetch and extract identity from seed URL(s)
  console.log('[Research] Fetching seed URL(s)...');

  let seedContent = '';
  for (const url of seedUrls) {
    if (fetchFunction) {
      try {
        const domain = (() => { try { return new URL(url).hostname.replace('www.', ''); } catch { return url; } })();
        emit(`Reading seed URL — ${domain}`, 'research', 2, TOTAL);
        const content = await fetchFunction(url);
        seedContent += `\n\n--- Content from ${url} ---\n${content}`;
        console.log(`[Research] Fetched seed URL: ${url} (${content.length} chars)`);
        emit(`Extracted ${content.length} characters from ${domain}`, 'research', 3, TOTAL);
      } catch (err) {
        console.error(`[Research] Failed to fetch seed URL: ${url}`, err);
      }
    }
  }

  // 2. Extract identity signals from seed content
  console.log('[Research] Extracting identity signals...');
  emit('Identifying role, org, and key affiliations', 'research', 4, TOTAL);
  let identity: any = { name: donorName, currentOrg: '', currentRole: '', locations: [], affiliations: [], uniqueIdentifiers: [] };

  if (seedContent) {
    const identityPrompt = `${IDENTITY_EXTRACTION_PROMPT}

Donor Name: ${donorName}

PAGE CONTENT:
${seedContent.slice(0, 15000)}

Extract the identity signals for this person.`;

    try {
      const identityResponse = await complete('You are a research assistant.', identityPrompt);
      const jsonMatch = identityResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        identity = JSON.parse(jsonMatch[0]);
        identity.name = identity.fullName || donorName;
      }
      console.log(`[Research] Identity extracted: ${identity.fullName || donorName} at ${identity.currentOrg || 'unknown org'}`);
    } catch (err) {
      console.error('[Research] Identity extraction failed:', err);
    }
  }

  emit(
    `Identified: ${identity.fullName || donorName} — ${identity.currentRole || 'unknown role'} at ${identity.currentOrg || 'unknown org'}`,
    'research', 5, TOTAL
  );

  // 3. Generate targeted search queries using identity signals
  console.log('[Research] Generating targeted search queries...');
  emit('Designing research strategy', 'research', 6, TOTAL);
  const queryPrompt = generateResearchQueries(donorName, identity);
  const queryResponse = await complete('You are a research strategist.', queryPrompt);

  let queries: GeneratedQuery[] = [];
  try {
    const jsonMatch = queryResponse.match(/\[[\s\S]*\]/);
    queries = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch {
    // Fallback queries if LLM parsing fails
    const org = identity.currentOrg || '';
    queries = [
      { query: `"${donorName}" interview`, tier: 'STANDARD', rationale: 'Basic interview search' },
      { query: `"${donorName}" ${org} profile`, tier: 'STANDARD', rationale: 'Profile at current org' },
      { query: `"${donorName}" philanthropy foundation`, tier: 'STANDARD', rationale: 'Philanthropic activity' },
      { query: `"${donorName}" speech keynote`, tier: 'STANDARD', rationale: 'Public speaking' },
      { query: `${org || donorName} grants 2024`, tier: 'TAILORED', rationale: 'Recent org activity' },
      { query: `${org || donorName} announcement`, tier: 'TAILORED', rationale: 'Org press releases' },
    ];
  }

  const standardCount = queries.filter(q => q.tier === 'STANDARD').length;
  const tailoredCount = queries.filter(q => q.tier === 'TAILORED').length;
  console.log(`[Research] Generated ${queries.length} queries (${standardCount} standard, ${tailoredCount} tailored)`);
  queries.forEach((q, i) => {
    console.log(`  ${i + 1}. [${q.tier}] ${q.query}`);
    console.log(`      Rationale: ${q.rationale}`);
  });
  emit(`Researching ${queries.length} angles — ${standardCount} standard, ${tailoredCount} tailored`, 'research', 7, TOTAL);

  // 4. Execute searches
  console.log('[Research] Executing searches...');
  const allSources: { url: string; title: string; snippet: string; query: string }[] = [];
  let searchedCount = 0;

  for (const q of queries) {
    try {
      if (searchedCount === 0) {
        emit(`Searching: "${q.query}"`, 'research', 8, TOTAL);
      }
      const results = await searchFunction(q.query);
      for (const r of results) {
        allSources.push({ ...r, query: q.query });
      }
      searchedCount++;
      if (searchedCount % 3 === 0 || searchedCount === queries.length) {
        emit(`Searched ${searchedCount} of ${queries.length} queries — ${allSources.length} results so far`, 'research', 9, TOTAL);
      }
    } catch (err) {
      console.error(`[Research] Search failed for: ${q.query}`, err);
      searchedCount++;
    }
  }

  // Deduplicate by URL
  const uniqueSources = Array.from(
    new Map(allSources.map(s => [s.url, s])).values()
  );

  console.log(`[Research] Collected ${uniqueSources.length} unique sources before screening`);
  emit(`${uniqueSources.length} results from ${queries.length} searches`, 'research', 10, TOTAL);

  // Tavily extract for top sources
  emit('Reading full text from top sources', 'research', 11, TOTAL);

  // 5. Screen sources for relevance to THIS person
  console.log('[Research] Screening sources for relevance...');
  emit(`Verifying sources match the right ${donorName}`, 'research', 12, TOTAL);
  const screenedSources = await screenSourcesForRelevance(uniqueSources, identity, donorName, emit);

  const dropped = uniqueSources.length - screenedSources.length;
  console.log(`[Research] After screening: ${screenedSources.length} relevant sources (dropped ${dropped})`);
  emit(`Confirmed ${screenedSources.length} relevant sources (dropped ${dropped} false matches)`, 'research', 14, TOTAL);

  // 6. Generate raw research document
  const rawMarkdown = generateResearchMarkdown(donorName, identity, queries, screenedSources);

  return {
    donorName,
    identity,
    queries,
    sources: screenedSources,
    rawMarkdown
  };
}

async function screenSourcesForRelevance(
  sources: { url: string; title: string; snippet: string }[],
  identity: any,
  donorName: string,
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

      const screenPrompt = `Screen these search results to determine if they are about the correct person.

TARGET PERSON:
- Name: ${donorName}
- Current Role: ${identity.currentRole || 'Unknown'}
- Current Organization: ${identity.currentOrg || 'Unknown'}
- Locations: ${(identity.locations || []).join(', ') || 'Unknown'}
- Affiliations: ${(identity.affiliations || []).join(', ') || 'Unknown'}
- Unique Identifiers: ${(identity.uniqueIdentifiers || []).join(', ') || 'None'}

SEARCH RESULTS TO SCREEN:
${batch.map((s, idx) => `
[${idx}]
URL: ${s.url}
Title: ${s.title}
Snippet: ${s.snippet}
`).join('\n')}

For each result, determine if it's about the TARGET PERSON or a different person.
Be conservative - if uncertain, mark as not a match.

Output as JSON array (one entry per result, in order):
[
  { "index": 0, "isMatch": true, "confidence": "high", "reason": "brief explanation" },
  { "index": 1, "isMatch": false, "confidence": "high", "reason": "different person - wrong company" }
]`;

      try {
        const response = await complete('You are screening search results for identity matching.', screenPrompt);
        const jsonMatch = response.match(/\[[\s\S]*\]/);

        if (jsonMatch) {
          const results = JSON.parse(jsonMatch[0]);
          for (const r of results) {
            if (r.isMatch && (r.confidence === 'high' || r.confidence === 'medium')) {
              screened.push(batch[r.index]);
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

  return screened;
}

function generateResearchMarkdown(
  donorName: string,
  identity: any,
  queries: GeneratedQuery[],
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
    ...queries.map(q => `- [${q.tier}] ${q.query} — ${q.rationale}`),
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
  STATUS.tiersPrioritized(tierCounts[1], tierCounts[2], tierCounts[3], tierCounts[4]);

  // Log top 5 sources to verify ranking
  console.log(`[Dossier] Top 5 sources by behavioral value:`);
  for (const s of rankedSources.slice(0, 5)) {
    console.log(`[Dossier]   [T${s.tier}] ${s.title?.slice(0, 60) || s.url}`);
  }

  // Cap at 50 sources maximum to prevent timeouts and rate limits
  const MAX_SOURCES = 50;
  const sourcesToProcess = rankedSources.slice(0, MAX_SOURCES);
  console.log(`[Dossier] Processing top ${sourcesToProcess.length} sources (capped at ${MAX_SOURCES})`);
  STATUS.processingTop(sourcesToProcess.length);

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

        console.log(`[Dossier] Batch ${batchNumber}: ✓ Extracted ${parsedResults.length} sources`);
        STATUS.batchComplete(batchNumber, i + 1, batchEnd);
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
      STATUS.batchFailed(batchNumber, errorMessage);
    }

    // Rate limiting: 3 second delay between batch API calls
    if (i + BATCH_SIZE < validSources.length) {
      await delay(3000);
    }
  }

  console.log(`[Dossier] Extraction complete: ${totalProcessed} processed in ${batchNumber} batches, ${failed} failed, ${skipped} skipped`);
  
  // 2. Synthesize by dimension
  console.log('[Dossier] Synthesizing dimensions...');
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
  console.log('[Dossier] Generating cross-cutting analysis...');
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
// Profile ALWAYS ships - validation is informational, never blocks
export async function generateProfile(
  donorName: string,
  dossier: string,
  canonDocs: { exemplars: string }
): Promise<ProfileResult> {
  console.log(`[Profile] Starting generation for: ${donorName}`);

  const exemplars = selectExemplars(dossier, canonDocs.exemplars);
  const systemPrompt = 'You are writing a donor persuasion profile.';

  // Initial generation
  console.log('[Profile] Generating initial draft...');
  STATUS.generatingDraft();
  let profile: string;
  try {
    const profilePrompt = createProfilePrompt(donorName, dossier, exemplars);
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

  // Validation loop - wrapped in try/catch so it never blocks shipping
  const maxAttempts = 3;
  let validationResults: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[Profile] Validation attempt ${attempt}/${maxAttempts}...`);
      STATUS.validationAttempt(attempt, maxAttempts);

      const validation = await runAllValidators(profile, dossier);

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
            dossier,
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
  STATUS.researchComplete(research.sources.length);
  
  // Step 2: Dossier
  const dossier = await extractDossier(donorName, research.sources, canonDocs);
  console.log(`\n[Pipeline] Dossier complete\n`);
  STATUS.dossierComplete();
  
  // Step 3: Profile
  const profile = await generateProfile(donorName, dossier.rawMarkdown, canonDocs);
  console.log(`\n[Pipeline] Profile complete: ${profile.status}\n`);
  
  console.log(`${'='.repeat(60)}`);
  console.log(`PROSPECTAI: Complete`);
  console.log(`${'='.repeat(60)}\n`);
  
  return { research, dossier, profile };
}
