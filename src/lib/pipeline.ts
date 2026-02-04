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
  SYNTHESIS_PROMPT,
  CROSS_CUTTING_PROMPT,
  DIMENSIONS
} from './prompts/extraction';
import {
  createProfilePrompt,
  createRegenerationPrompt
} from './prompts/profile';
import { createValidationPrompt } from './prompts/validation';
import { CANON_SUMMARY, PROFILE_QUALITY_CHECKLIST, selectExemplars } from './canon/loader';

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

// Step 2: Dossier Extraction
export async function extractDossier(
  donorName: string,
  sources: { url: string; title: string; snippet: string; content?: string }[],
  canonDocs: { exemplars: string }
): Promise<DossierResult> {
  console.log(`[Dossier] Starting extraction for: ${donorName}`);
  console.log(`[Dossier] Total sources available: ${sources.length}`);

  // Cap at 50 sources maximum to prevent timeouts and rate limits
  const MAX_SOURCES = 50;
  const sourcesToProcess = sources.slice(0, MAX_SOURCES);
  console.log(`[Dossier] Processing ${sourcesToProcess.length} sources (capped at ${MAX_SOURCES})`);

  // 1. Extract from each source
  const allEvidence: any[] = [];
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const source of sourcesToProcess) {
    // Skip sources without meaningful content
    if (!source.content && source.snippet.length < 100) {
      skipped++;
      continue;
    }

    processed++;
    const sourceIndex = processed;
    console.log(`[Dossier] [${sourceIndex}/${sourcesToProcess.length}] Extracting: ${source.title?.slice(0, 50) || source.url.slice(0, 50)}...`);

    // Sanitize content to remove images before sending to Claude
    const rawContent = source.content || source.snippet;
    const content = sanitizeForClaude(rawContent);
    const extractionPrompt = createExtractionPrompt(
      donorName,
      { title: source.title, url: source.url, type: 'UNKNOWN' },
      content
    );

    try {
      // 30 second timeout per source extraction
      const extraction = await withTimeout(
        complete(
          'You are extracting behavioral evidence for donor profiling.',
          extractionPrompt,
          { maxTokens: 4096 }
        ),
        30000,
        `Timeout extracting from ${source.url}`
      );

      allEvidence.push({
        source: source.url,
        extraction
      });
      console.log(`[Dossier] [${sourceIndex}/${sourcesToProcess.length}] ✓ Success`);
    } catch (err) {
      failed++;
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[Dossier] [${sourceIndex}/${sourcesToProcess.length}] ✗ Failed: ${errorMessage.slice(0, 100)}`);
    }

    // Rate limiting: 2 second delay between API calls to avoid hitting 30k tokens/min limit
    await delay(2000);
  }

  console.log(`[Dossier] Extraction complete: ${allEvidence.length} succeeded, ${failed} failed, ${skipped} skipped`);
  
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
  const systemPrompt = `You are a world-class donor profiler following the DTW canon.

${CANON_SUMMARY}

${PROFILE_QUALITY_CHECKLIST}`;
  
  // Initial generation
  console.log('[Profile] Generating initial draft...');
  const profilePrompt = createProfilePrompt(donorName, dossier, exemplars);
  let profile = await completeExtended(systemPrompt, profilePrompt, { maxTokens: 10000 });
  
  // Validation loop
  const maxAttempts = 3;
  let attempts = 0;
  let validationPasses = 0;
  
  while (attempts < maxAttempts) {
    attempts++;
    console.log(`[Profile] Validation attempt ${attempts}...`);
    
    const validationPrompt = createValidationPrompt(donorName, dossier, exemplars, profile);
    const validation = await complete(
      'You are a rigorous quality validator for donor profiles.',
      validationPrompt,
      { maxTokens: 2000 }
    );
    
    if (validation.trim().toUpperCase().startsWith('PASS')) {
      console.log('[Profile] Validation PASSED');
      validationPasses = attempts;
      return {
        donorName,
        profile,
        validationPasses,
        status: 'complete'
      };
    }
    
    console.log(`[Profile] Validation failed: ${validation.slice(0, 200)}...`);
    
    if (attempts < maxAttempts) {
      console.log('[Profile] Regenerating with feedback...');
      const regenPrompt = createRegenerationPrompt(donorName, dossier, exemplars, profile, validation);
      profile = await completeExtended(systemPrompt, regenPrompt, { maxTokens: 10000 });
    }
  }
  
  console.log('[Profile] Max attempts reached, returning best effort');
  return {
    donorName,
    profile: profile + '\n\n---\n\n*Note: This profile did not fully pass validation after 3 attempts.*',
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
