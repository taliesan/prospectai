// Core pipeline for donor profiling
// This orchestrates the three steps: Research → Dossier → Profile
// v3: Rebuilt source collection with tiering, screening, and blog crawling

import { complete, completeExtended } from './anthropic';
import { sanitizeForClaude } from './sanitize';
import { STATUS } from './progress';
import {
  IDENTITY_EXTRACTION_PROMPT,
  generateResearchQueries,
  parseAnalyticalQueries,
  SOURCE_CLASSIFICATION_PROMPT
} from './prompts/research';
import {
  createExtractionPrompt,
  createBatchExtractionPrompt,
  SYNTHESIS_PROMPT,
  CROSS_CUTTING_PROMPT,
  DIMENSIONS
} from './prompts/extraction';
import type { LinkedInData } from './prompts/extraction-prompt';
import {
  createProfilePrompt,
  createRegenerationPrompt
} from './prompts/profile';
import { runAllValidators } from './validators';
import { selectExemplars } from './canon/loader';

// New v3 research modules
import { ResearchSource, runScreeningPipeline } from './research/screening';
import { crawlSubjectPublishing } from './research/blog-crawler';
import {
  tierSources,
  enforceTargets,
  TieredSource,
  TIER_PREAMBLE,
  buildEvidenceGapBlock
} from './research/tiering';

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
  tier1Count?: number;
  tier2Count?: number;
  tier3Count?: number;
  evidenceWarnings?: string[];
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

// Step 1: Research (v3 — with blog crawling, aggressive screening, tiering)
export async function conductResearch(
  donorName: string,
  seedUrls: string[] = [],
  searchFunction: (query: string) => Promise<{ url: string; title: string; snippet: string; fullContent?: string }[]>,
  fetchFunction?: (url: string) => Promise<string>,
  onProgress?: ResearchProgressCallback,
  linkedinData?: LinkedInData | null
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

  // Enrich identity with LinkedIn data (authoritative for biographical facts)
  // Step 1 (above): Always extract identity from seed URL — provides affiliations, unique identifiers, context
  // Step 2 (here): LinkedIn overrides biographical facts (title, employer, career, education)
  if (linkedinData) {
    console.log(`[Research] Enriching identity with LinkedIn data: ${linkedinData.currentTitle} at ${linkedinData.currentEmployer}`);

    // LinkedIn is authoritative for current role/org — always override
    identity.currentRole = linkedinData.currentTitle || identity.currentRole;
    identity.currentOrg = linkedinData.currentEmployer || identity.currentOrg;

    // Career history from LinkedIn (authoritative)
    if (linkedinData.careerHistory?.length) {
      identity.pastRoles = linkedinData.careerHistory.map(j => ({
        role: j.title,
        org: j.employer,
        years: `${j.startDate} - ${j.endDate}`
      }));
    }

    // Education from LinkedIn (authoritative)
    if (linkedinData.education?.length) {
      identity.education = linkedinData.education.map(e => ({
        school: e.institution,
        degree: e.degree,
        year: e.years
      }));
    }

    // Add LinkedIn boards to affiliations (merge, don't replace)
    const existingAffiliations = new Set((identity.affiliations || []).map((a: string) => a.toLowerCase()));
    for (const board of (linkedinData.boards || [])) {
      if (!existingAffiliations.has(board.toLowerCase())) {
        identity.affiliations = identity.affiliations || [];
        identity.affiliations.push(board);
        existingAffiliations.add(board.toLowerCase());
      }
    }

    // Add past employers to affiliations (merge, don't replace)
    for (const job of (linkedinData.careerHistory || [])) {
      if (job.employer && job.employer !== linkedinData.currentEmployer && !existingAffiliations.has(job.employer.toLowerCase())) {
        identity.affiliations = identity.affiliations || [];
        identity.affiliations.push(job.employer);
        existingAffiliations.add(job.employer.toLowerCase());
      }
    }

    // Add education institutions to uniqueIdentifiers (helps disambiguation)
    for (const edu of (linkedinData.education || [])) {
      if (edu.institution) {
        identity.uniqueIdentifiers = identity.uniqueIdentifiers || [];
        if (!identity.uniqueIdentifiers.includes(edu.institution)) {
          identity.uniqueIdentifiers.push(edu.institution);
        }
      }
    }

    // Keep uniqueIdentifiers from seed URL — LinkedIn doesn't provide these
    console.log(`[Research] Identity after LinkedIn enrichment:`, JSON.stringify(identity, null, 2));
  }

  emit(
    `Identified: ${identity.fullName || donorName} — ${identity.currentRole || 'unknown role'} at ${identity.currentOrg || 'unknown org'}`,
    'research', 5, TOTAL
  );

  // ── Crawl subject's own publishing first ────────────────────────
  let tier1Sources: ResearchSource[] = [];
  if (fetchFunction) {
    emit('Crawling subject\'s personal publishing', 'research', 6, TOTAL);
    try {
      tier1Sources = await crawlSubjectPublishing(
        donorName,
        seedUrls,
        identity,
        searchFunction as any,
        fetchFunction
      );
      console.log(`[Research] Blog/publishing crawl: ${tier1Sources.length} Tier 1 sources`);
      if (tier1Sources.length > 0) {
        emit(`Found ${tier1Sources.length} posts from subject's own publishing`, 'research', 6, TOTAL);
      }
    } catch (err) {
      console.error('[Research] Blog crawl failed:', err);
    }
  }

  // 3. Generate targeted search queries using identity signals (analytical categories A-E)
  console.log('[Research] Generating analytical search queries...');
  emit('Designing research strategy with analytical categories', 'research', 7, TOTAL);
  const queryPrompt = generateResearchQueries(donorName, identity, seedContent.slice(0, 3000));
  const queryResponse = await complete('You are a research analyst designing search queries for behavioral evidence.', queryPrompt);

  // Parse queries — analytical categories internally, mapped to GeneratedQuery for pipeline compat
  let queries: GeneratedQuery[] = [];
  const analyticalQueries = parseAnalyticalQueries(queryResponse);

  // Map analytical categories to STANDARD/TAILORED tiers:
  // A (known outputs) + C (community) → STANDARD (identity-linked searches)
  // B (pressure points) + D (org context) + E (gap-filling) → TAILORED (investigative)
  const categoryToTier = (cat: string): 'STANDARD' | 'TAILORED' => {
    return (cat === 'A' || cat === 'C') ? 'STANDARD' : 'TAILORED';
  };

  if (analyticalQueries.length > 0) {
    queries = analyticalQueries.map(q => ({
      query: q.query,
      tier: categoryToTier(q.category),
      rationale: `[Cat ${q.category}] ${q.hypothesis}`,
    }));

    // Log category distribution
    const catCounts: Record<string, number> = {};
    for (const q of analyticalQueries) {
      catCounts[q.category] = (catCounts[q.category] || 0) + 1;
    }
    console.log(`[Query Gen] Generated ${queries.length} queries:`);
    console.log(`  Category A (known outputs): ${catCounts['A'] || 0}`);
    console.log(`  Category B (pressure points): ${catCounts['B'] || 0}`);
    console.log(`  Category C (community): ${catCounts['C'] || 0}`);
    console.log(`  Category D (org context): ${catCounts['D'] || 0}`);
    console.log(`  Category E (gap-filling): ${catCounts['E'] || 0}`);
  } else {
    // Fallback: try old format parsing
    try {
      const jsonMatch = queryResponse.match(/\[[\s\S]*\]/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
      queries = parsed.map((q: any) => ({
        query: q.query,
        tier: q.tier || categoryToTier(q.category || 'E'),
        rationale: q.rationale || q.hypothesis || '',
      }));
    } catch {
      // Fallback queries with identity context
      const org = identity.currentOrg || '';
      queries = [
        { query: `"${donorName}" ${org} interview`, tier: 'STANDARD', rationale: 'Basic interview search' },
        { query: `"${donorName}" ${org} podcast`, tier: 'STANDARD', rationale: 'Podcast appearances' },
        { query: `"${donorName}" ${org} philanthropy`, tier: 'STANDARD', rationale: 'Philanthropic activity' },
        { query: `"${donorName}" ${org} profile`, tier: 'STANDARD', rationale: 'Profile at current org' },
        { query: `${org || donorName} grants 2024`, tier: 'TAILORED', rationale: 'Recent org activity' },
        { query: `${org || donorName} announcement`, tier: 'TAILORED', rationale: 'Org press releases' },
      ];
    }
    console.log(`[Research] Generated ${queries.length} queries (fallback format)`);
  }

  const standardCount = queries.filter(q => q.tier === 'STANDARD').length;
  const tailoredCount = queries.filter(q => q.tier === 'TAILORED').length;
  console.log(`[Research] ${standardCount} standard, ${tailoredCount} tailored`);
  queries.forEach((q, i) => {
    console.log(`  ${i + 1}. [${q.tier}] ${q.query}`);
    console.log(`      Rationale: ${q.rationale}`);
  });
  emit(`Researching ${queries.length} angles — ${standardCount} standard, ${tailoredCount} tailored`, 'research', 7, TOTAL);

  // 4. Execute searches
  console.log('[Research] Executing searches...');
  const allSources: ResearchSource[] = [];
  const tailoredUrls = new Set<string>(); // Track which URLs came from TAILORED queries
  let searchedCount = 0;

  for (const q of queries) {
    try {
      if (searchedCount === 0) {
        emit(`Searching: "${q.query}"`, 'research', 8, TOTAL);
      }
      const results = await searchFunction(q.query);
      for (const r of results) {
        allSources.push({
          url: r.url,
          title: r.title,
          snippet: r.snippet,
          content: (r as any).fullContent || (r as any).content || undefined,
          query: q.query,
          source: 'tavily',
        });
        if (q.tier === 'TAILORED') {
          tailoredUrls.add(r.url);
        }
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
  const urlMap = new Map<string, ResearchSource>();
  // Add tier1 sources first (priority)
  for (const s of tier1Sources) {
    urlMap.set(s.url, s);
  }
  // Then add Tavily sources (won't override tier1)
  for (const s of allSources) {
    if (!urlMap.has(s.url)) {
      urlMap.set(s.url, s);
    }
  }
  const uniqueSources = Array.from(urlMap.values());

  console.log(`[Research] Collected ${uniqueSources.length} unique sources (${tier1Sources.length} from publishing crawl, ${allSources.length} from Tavily)`);
  emit(`${uniqueSources.length} results from ${queries.length} searches + ${tier1Sources.length} blog posts`, 'research', 10, TOTAL);

  // Tavily extract for top sources
  emit('Reading full text from top sources', 'research', 11, TOTAL);

  // 5. Aggressive pre-extraction screening pipeline
  console.log('[Research] Running aggressive screening pipeline...');
  console.log(`[Research] ${tailoredUrls.size} URLs came from tailored queries`);
  emit(`Screening ${uniqueSources.length} sources for behavioral evidence`, 'research', 12, TOTAL);

  const { screened: screenedSources, stats: screeningStats } = await runScreeningPipeline(
    uniqueSources,
    donorName,
    identity
  );

  emit(`Screened: ${screeningStats.autoRejected} auto-rejected, ${screeningStats.llmRejected} LLM-rejected`, 'research', 13, TOTAL);

  // ── NEW: Tier and enforce targets ────────────────────────────────
  const tieredSources = tierSources(screenedSources, donorName);
  const { selected: finalSources, warnings: evidenceWarnings } = enforceTargets(tieredSources);

  const finalTier1 = finalSources.filter(s => s.tier === 1).length;
  const finalTier2 = finalSources.filter(s => s.tier === 2).length;
  const finalTier3 = finalSources.filter(s => s.tier === 3).length;

  console.log(`[Research] === Source Collection Summary ===`);
  console.log(`[Research] Blog crawl: ${tier1Sources.length} posts`);
  console.log(`[Research] Tavily queries: ${queries.length}`);
  console.log(`[Research] Raw sources collected: ${uniqueSources.length}`);
  console.log(`[Screening] Automatic rejections: ${screeningStats.autoRejected}`);
  console.log(`[Screening] LLM rejections: ${screeningStats.llmRejected}`);
  console.log(`[Screening] Deduplication: ${screeningStats.beforeDedup} → ${screeningStats.afterDedup}`);
  console.log(`[Tiering] Tier 1: ${finalTier1}, Tier 2: ${finalTier2}, Tier 3: ${finalTier3}`);
  console.log(`[Targets] Final selection: ${finalSources.length} sources`);
  if (evidenceWarnings.length > 0) {
    console.log(`[Warnings] ${evidenceWarnings.join('; ')}`);
  }

  const dropped = uniqueSources.length - finalSources.length;
  emit(`${finalSources.length} quality sources selected (${finalTier1} T1, ${finalTier2} T2, ${finalTier3} T3) — dropped ${dropped}`, 'research', 14, TOTAL);

  // 6. Generate raw research document
  const rawMarkdown = generateResearchMarkdown(donorName, identity, queries, finalSources);

  return {
    donorName,
    identity,
    queries,
    sources: finalSources,
    rawMarkdown,
    tier1Count: finalTier1,
    tier2Count: finalTier2,
    tier3Count: finalTier3,
    evidenceWarnings,
  };
}

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

function generateResearchMarkdown(
  donorName: string,
  identity: any,
  queries: GeneratedQuery[],
  sources: (TieredSource | { url: string; title: string; snippet: string })[]
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
    ...sources.map((s, i) => {
      const tierLabel = 'tier' in s ? ` [TIER ${s.tier}]` : '';
      return [
        `### ${i + 1}. ${s.title}${tierLabel}`,
        `URL: ${s.url}`,
        `Snippet: ${s.snippet}`,
        ''
      ].join('\n');
    })
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

// Source ranking by behavioral signal value (kept for backward compat with extractDossier)
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
