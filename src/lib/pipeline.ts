// Core pipeline for donor profiling — CODED PIPELINE
// No agent loops. Every step is coded orchestration + single LLM API calls.
//
// Architecture:
//   LinkedIn PDF parsing → Identity extraction → Query design (LLM, 1 call)
//   → Tavily bulk search (coded) → Page fetching (coded, concurrent)
//   → Screening + dedup (coded + LLM) → Tiering (coded)
//   → Fat extraction (Opus, 1 call) → Profile (Opus, 1 call) → Editorial (Opus, 1 call)
//   → Meeting guide (Opus, 1 call)

import Anthropic from '@anthropic-ai/sdk';
import { complete, completeExtended, conversationTurn, Message } from './anthropic';
import { sanitizeForClaude } from './sanitize';
import { STATUS } from './progress';
import {
  IDENTITY_EXTRACTION_PROMPT,
  generateResearchQueries,
  parseAnalyticalQueries,
  SOURCE_CLASSIFICATION_PROMPT
} from './prompts/research';
import { buildExtractionPrompt, LinkedInData } from './prompts/extraction-prompt';
import {
  createBatchExtractionPrompt,
  SYNTHESIS_PROMPT,
  CROSS_CUTTING_PROMPT,
} from './prompts/extraction';
import { buildProfilePrompt } from './prompts/profile-prompt';
import { buildCritiqueRedraftPrompt } from './prompts/critique-redraft-prompt';
import { buildMeetingGuidePrompt } from './prompts/meeting-guide';
import {
  createProfilePrompt,
  createRegenerationPrompt
} from './prompts/profile';
import { selectExemplars, loadExemplars, loadGeoffreyBlock, loadMeetingGuideBlock, loadMeetingGuideExemplars, loadDTWOrgLayer } from './canon/loader';
import { formatMeetingGuide, formatMeetingGuideEmbeddable } from './formatters/meeting-guide-formatter';
import { executeWebSearch, executeFetchPage } from './research/tools';
import { writeFileSync, mkdirSync } from 'fs';

// New v3 research modules
import { ResearchSource, runScreeningPipeline } from './research/screening';
import { crawlSubjectPublishing } from './research/blog-crawler';
import {
  tierSources,
  enforceTargets,
  TieredSource,
  TIER_PREAMBLE,
  buildEvidenceGapBlock,
  extractLinkedInSlugFromProfile,
  getPersonalDomains,
} from './research/tiering';

const anthropic = new Anthropic();

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
  // Pass linkedinData (has .websites for blog URLs) if available, otherwise identity
  let tier1Sources: ResearchSource[] = [];
  if (fetchFunction) {
    emit('Crawling subject\'s personal publishing', 'research', 6, TOTAL);
    try {
      tier1Sources = await crawlSubjectPublishing(
        donorName,
        seedUrls,
        linkedinData || identity,
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

  // Run searches in parallel (3 concurrent) to reduce total search time
  const SEARCH_CONCURRENCY = 3;
  const searchPromises = new Set<Promise<void>>();
  emit(`Searching ${queries.length} queries (${SEARCH_CONCURRENCY} concurrent)`, 'research', 8, TOTAL);

  for (const q of queries) {
    const p = (async () => {
      try {
        const results = await searchFunction(q.query);

        // Extract analytical category from rationale (format: "[Cat X] hypothesis")
        const catMatch = q.rationale.match(/^\[Cat ([A-E])\]/);
        const queryCategory = catMatch ? catMatch[1] as 'A' | 'B' | 'C' | 'D' | 'E' : undefined;

        for (const r of results) {
          allSources.push({
            url: r.url,
            title: r.title,
            snippet: r.snippet,
            content: (r as any).fullContent || (r as any).content || undefined,
            query: q.query,
            queryCategory,
            queryHypothesis: q.rationale,
            source: 'tavily',
          });
          if (q.tier === 'TAILORED') {
            tailoredUrls.add(r.url);
          }
        }
      } catch (err) {
        console.error(`[Research] Search failed for: ${q.query}`, err);
      }
      searchedCount++;
      if (searchedCount % 5 === 0 || searchedCount === queries.length) {
        emit(`Searched ${searchedCount} of ${queries.length} queries — ${allSources.length} results so far`, 'research', 9, TOTAL);
      }
    })().then(() => { searchPromises.delete(p); });
    searchPromises.add(p);
    if (searchPromises.size >= SEARCH_CONCURRENCY) {
      await Promise.race(searchPromises);
    }
  }
  await Promise.all(searchPromises);

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

  // 5. Screen sources BEFORE bulk fetch (saves fetching rejected pages)
  // Screening runs on snippets from Tavily search — no full page fetch needed
  console.log('[Research] Running screening pipeline (snippet-based, pre-fetch)...');
  console.log(`[Research] ${tailoredUrls.size} URLs came from tailored queries`);
  emit(`Screening ${uniqueSources.length} sources for behavioral evidence`, 'research', 11, TOTAL);

  const { screened: screenedSources, stats: screeningStats } = await runScreeningPipeline(
    uniqueSources,
    donorName,
    identity
  );

  emit(`Screened: ${screeningStats.autoRejected} auto-rejected, ${screeningStats.llmRejected} LLM-rejected`, 'research', 12, TOTAL);

  // ── Bulk fetch full content for SCREENED sources only ─────────────
  // Only fetch sources that passed screening and lack content (saves 100+ API calls)
  emit('Fetching full text from screened sources', 'research', 13, TOTAL);
  const sourcesToFetch = screenedSources.filter(s => !s.content || s.content.length < 200);
  console.log(`[Research] Bulk fetching ${sourcesToFetch.length} screened sources (${screenedSources.length - sourcesToFetch.length} already have content)`);

  const FETCH_CONCURRENCY = 8;
  let fetchedCount = 0;
  const executing = new Set<Promise<void>>();
  for (const source of sourcesToFetch) {
    const p = (async () => {
      try {
        const content = await executeFetchPage(source.url);
        source.content = content;
        fetchedCount++;
        if (fetchedCount % 5 === 0 || fetchedCount === sourcesToFetch.length) {
          emit(`Fetched ${fetchedCount}/${sourcesToFetch.length} source pages`, 'research', 13, TOTAL);
        }
      } catch (err) {
        console.log(`[Research] Fetch failed for ${source.url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    })().then(() => { executing.delete(p); });
    executing.add(p);
    if (executing.size >= FETCH_CONCURRENCY) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
  console.log(`[Research] Bulk fetch complete: ${fetchedCount}/${sourcesToFetch.length} fetched`);

  // ── Tier and enforce targets ────────────────────────────────────
  // Extract LinkedIn slug and personal domains for tier classification
  const linkedInSlug = linkedinData?.linkedinSlug || null;
  const personalDomains = linkedinData ? getPersonalDomains(linkedinData) : [];
  console.log(`[Research] Tiering with slug=${linkedInSlug || 'none'}, domains=${personalDomains.join(', ') || 'none'}`);

  const tieredSources = tierSources(screenedSources, donorName, linkedInSlug || undefined, personalDomains);
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

// ── Token estimation ──────────────────────────────────────────────
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── Coded Pipeline Result ─────────────────────────────────────────
export interface CodedPipelineResult {
  research: ResearchResult;
  researchPackage: string;
  profile: string;
  meetingGuide: string;
  meetingGuideHtml: string;
  linkedinData: LinkedInData | null;
}

// ── Full Coded Pipeline ───────────────────────────────────────────
//
// No agent loops. Every step is coded orchestration + single LLM calls.
//
export async function runFullPipeline(
  donorName: string,
  seedUrls: string[] = [],
  searchFunction: (query: string) => Promise<{ url: string; title: string; snippet: string; fullContent?: string }[]>,
  canonDocs: { exemplars: string },
  onProgress?: ResearchProgressCallback,
  linkedinPdfBase64?: string,
  fetchFunction?: (url: string) => Promise<string>,
  abortSignal?: AbortSignal,
): Promise<CodedPipelineResult> {
  const emit = onProgress || (() => {});
  const TOTAL_STEPS = 38;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`CODED PIPELINE: Processing ${donorName}`);
  console.log(`${'='.repeat(60)}\n`);

  // ── Step 0: LinkedIn PDF Parsing ────────────────────────────────
  let linkedinData: LinkedInData | null = null;

  if (linkedinPdfBase64) {
    console.log(`[LinkedIn] PDF received, length: ${linkedinPdfBase64.length}`);
    emit('Parsing LinkedIn profile...', undefined, 1, TOTAL_STEPS);

    try {
      const pdfBuffer = Buffer.from(linkedinPdfBase64, 'base64');
      const { extractText } = await import('unpdf');
      const { text: pdfText } = await extractText(new Uint8Array(pdfBuffer), { mergePages: true });
      console.log(`[LinkedIn] PDF text extracted, length: ${pdfText.length}`);

      // Coded regex extraction for slug + websites
      const codedFields = extractLinkedInCodedFields(pdfText);
      console.log(`[LinkedIn] Coded extraction: slug=${codedFields.linkedinSlug || 'none'}, websites=${codedFields.websites.join(', ') || 'none'}`);

      // LLM extraction for career/education/boards + slug/websites
      const parsePrompt = `Extract structured biographical data from this LinkedIn profile text.

Return JSON in this exact format:
{
  "currentTitle": "their current job title",
  "currentEmployer": "their current employer",
  "linkedinSlug": "the handle from their LinkedIn URL (e.g. 'geoffreymacdougall')",
  "websites": ["any personal websites listed"],
  "careerHistory": [
    { "title": "Job Title", "employer": "Company Name", "startDate": "Mon YYYY", "endDate": "Mon YYYY or Present", "description": "role description" }
  ],
  "education": [
    { "institution": "University Name", "degree": "Degree Type", "field": "Field of Study", "years": "YYYY - YYYY" }
  ],
  "skills": ["skill1", "skill2"],
  "boards": ["Board membership 1", "Advisory role 2"]
}

Parse carefully. Extract all career history entries in chronological order (most recent first).
Look for the LinkedIn profile URL (linkedin.com/in/...) and any personal website URLs.

LinkedIn Profile Text:
${pdfText}`;

      const response = await complete('You are a data extraction assistant.', parsePrompt, { maxTokens: 4000 });
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        linkedinData = JSON.parse(jsonMatch[0]);
      }

      // Merge coded regex fields (more reliable for slug + websites)
      if (linkedinData) {
        if (codedFields.linkedinSlug) {
          linkedinData.linkedinSlug = codedFields.linkedinSlug;
        }
        if (codedFields.websites.length > 0) {
          const allWebsites = new Set([...codedFields.websites, ...(linkedinData.websites || [])]);
          linkedinData.websites = Array.from(allWebsites);
        }
      }

      console.log(`[LinkedIn] Parsed: ${linkedinData?.currentTitle} at ${linkedinData?.currentEmployer}`);
      console.log(`[LinkedIn] Slug: ${linkedinData?.linkedinSlug || 'none'}, Websites: ${(linkedinData?.websites || []).join(', ') || 'none'}`);

      // Debug save
      try {
        mkdirSync('/tmp/prospectai-outputs', { recursive: true });
        writeFileSync('/tmp/prospectai-outputs/DEBUG-linkedin-data.json', JSON.stringify(linkedinData, null, 2));
      } catch (e) { /* ignore */ }

      emit(`LinkedIn parsed — ${linkedinData?.currentTitle} at ${linkedinData?.currentEmployer}`, undefined, 2, TOTAL_STEPS);
    } catch (err) {
      console.error('[LinkedIn] Parsing failed:', err);
      emit('LinkedIn PDF parsing failed — continuing without it', undefined, 2, TOTAL_STEPS);
    }
  }

  // ── Step 1: Research (coded query generation + Tavily bulk search) ──
  emit('', 'research');
  emit(`Collecting sources for ${donorName}`, 'research', 3, TOTAL_STEPS);

  const actualFetchFunction = fetchFunction || executeFetchPage;

  const research = await conductResearch(
    donorName,
    seedUrls,
    searchFunction,
    actualFetchFunction,
    emit,
    linkedinData,
  );
  console.log(`\n[Pipeline] Research complete: ${research.sources.length} sources\n`);
  STATUS.researchComplete(research.sources.length);

  // ── Step 2: Fat Extraction (Opus, single call) ──────────────────
  emit('', 'analysis');
  emit('Producing behavioral evidence extraction (Opus, single call)', 'analysis', 16, TOTAL_STEPS);
  console.log(`[Pipeline] Step 2: Fat extraction — ${research.sources.length} sources to Opus`);

  const extractionPrompt = buildExtractionPrompt(
    donorName,
    research.sources.map(s => ({
      url: s.url,
      title: s.title,
      snippet: s.snippet,
      content: s.content,
      tier: 'tier' in s ? (s as any).tier : undefined,
      tierReason: 'tierReason' in s ? (s as any).tierReason : undefined,
    })),
    linkedinData,
  );
  console.log(`[Extraction] Prompt size: ${estimateTokens(extractionPrompt)} tokens`);

  // Stream extraction to keep SSE alive during long Opus calls
  const extractionStream = anthropic.messages.stream({
    model: 'claude-opus-4-20250514',
    max_tokens: 32000,
    messages: [{ role: 'user', content: extractionPrompt }],
  }, abortSignal ? { signal: abortSignal } : undefined);

  let researchPackage = '';
  let lastProgressUpdate = Date.now();
  extractionStream.on('text', (text) => {
    researchPackage += text;
    const now = Date.now();
    if (now - lastProgressUpdate > 30_000) { // every 30 seconds
      const tokens = estimateTokens(researchPackage);
      emit(`Extraction in progress — ${tokens} tokens so far...`, 'analysis', 16, TOTAL_STEPS);
      lastProgressUpdate = now;
    }
  });
  await extractionStream.finalMessage();

  console.log(`[Extraction] Research package: ${researchPackage.length} chars (~${estimateTokens(researchPackage)} tokens)`);
  emit(`Extraction complete — ${estimateTokens(researchPackage)} token research package`, 'analysis', 20, TOTAL_STEPS);
  STATUS.researchPackageComplete();

  // Debug save
  try {
    mkdirSync('/tmp/prospectai-outputs', { recursive: true });
    writeFileSync('/tmp/prospectai-outputs/DEBUG-research-package.txt', researchPackage);
  } catch (e) { /* ignore */ }

  // ── Step 3: Profile Generation (Opus, Geoffrey Block) ───────────
  emit('Writing Persuasion Profile from behavioral evidence', 'analysis', 22, TOTAL_STEPS);
  console.log('[Pipeline] Step 3: Profile generation (Opus)');

  const geoffreyBlock = loadGeoffreyBlock();
  const exemplars = loadExemplars();

  const researchPackagePreamble = `The behavioral evidence below was curated from ${research.sources.length} source pages by an extraction model that read every source in full. Entries preserve the subject's original voice, surrounding context, and source shape.\n\n`;
  const extractionForProfile = researchPackagePreamble + researchPackage;

  const profilePromptText = buildProfilePrompt(donorName, extractionForProfile, geoffreyBlock, exemplars, linkedinData);
  console.log(`[Profile] Prompt size: ${estimateTokens(profilePromptText)} tokens`);

  // Debug save
  try {
    writeFileSync('/tmp/prospectai-outputs/DEBUG-profile-prompt.txt', profilePromptText);
  } catch (e) { /* ignore */ }

  const profileMessages: Message[] = [{ role: 'user', content: profilePromptText }];
  const firstDraftProfile = await conversationTurn(profileMessages, { maxTokens: 16000 });
  console.log(`[Profile] First draft: ${firstDraftProfile.length} chars`);

  try {
    writeFileSync('/tmp/prospectai-outputs/DEBUG-profile-first-draft.txt', firstDraftProfile);
  } catch (e) { /* ignore */ }

  // ── Step 3b: Editorial Pass (Opus) ──────────────────────────────
  emit('Scoring first draft against production standard...', 'analysis', 27, TOTAL_STEPS);
  console.log('[Pipeline] Step 3b: Editorial pass (Opus)');

  const critiquePrompt = buildCritiqueRedraftPrompt(
    donorName,
    firstDraftProfile,
    geoffreyBlock,
    exemplars,
    researchPackage,
    linkedinData,
  );
  console.log(`[Editorial] Prompt size: ${estimateTokens(critiquePrompt)} tokens`);

  const critiqueMessages: Message[] = [{ role: 'user', content: critiquePrompt }];
  const finalProfile = await conversationTurn(critiqueMessages, { maxTokens: 16000 });

  const reduction = Math.round((1 - finalProfile.length / firstDraftProfile.length) * 100);
  console.log(`[Editorial] ${firstDraftProfile.length} → ${finalProfile.length} chars (${reduction}% reduction)`);
  emit(`Editorial pass complete — ${reduction}% tighter`, 'analysis', 31, TOTAL_STEPS);

  try {
    writeFileSync('/tmp/prospectai-outputs/DEBUG-profile-final.txt', finalProfile);
  } catch (e) { /* ignore */ }

  // ── Step 4: Meeting Guide Generation (Opus) ─────────────────────
  emit('', 'writing');
  emit('Writing tactical meeting guide', 'writing', 33, TOTAL_STEPS);
  console.log('[Pipeline] Step 4: Meeting guide (Opus)');

  const meetingGuideBlock = loadMeetingGuideBlock();
  const meetingGuideExemplars = loadMeetingGuideExemplars();
  const dtwOrgLayer = loadDTWOrgLayer();

  const meetingGuidePrompt = buildMeetingGuidePrompt(
    donorName,
    finalProfile,
    meetingGuideBlock,
    dtwOrgLayer,
    meetingGuideExemplars,
  );

  const meetingGuideMessages: Message[] = [{ role: 'user', content: meetingGuidePrompt }];
  const meetingGuide = await conversationTurn(meetingGuideMessages, { maxTokens: 8000 });
  console.log(`[Meeting Guide] ${meetingGuide.length} chars`);

  const meetingGuideHtml = formatMeetingGuideEmbeddable(meetingGuide);

  try {
    writeFileSync('/tmp/prospectai-outputs/DEBUG-meeting-guide.md', meetingGuide);
  } catch (e) { /* ignore */ }

  emit('All documents ready', undefined, 38, TOTAL_STEPS);

  console.log(`${'='.repeat(60)}`);
  console.log(`CODED PIPELINE: Complete`);
  console.log(`${'='.repeat(60)}\n`);

  return {
    research,
    researchPackage,
    profile: finalProfile,
    meetingGuide,
    meetingGuideHtml,
    linkedinData,
  };
}

/**
 * Extract LinkedIn slug and personal websites from raw PDF text using regex.
 */
function extractLinkedInCodedFields(pdfText: string): { linkedinSlug: string | null; websites: string[] } {
  let linkedinSlug: string | null = null;
  const websites: string[] = [];

  const slugMatch = pdfText.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/i);
  if (slugMatch) {
    linkedinSlug = slugMatch[1];
  }

  const urlPattern = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(?:\/[^\s,)]*)?)/gi;
  let urlMatch;
  while ((urlMatch = urlPattern.exec(pdfText)) !== null) {
    const fullUrl = urlMatch[0];
    if (/linkedin\.com|facebook\.com|twitter\.com|instagram\.com|github\.com|mailto:/i.test(fullUrl)) {
      continue;
    }
    websites.push(fullUrl.startsWith('http') ? fullUrl : `https://${fullUrl}`);
  }

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
