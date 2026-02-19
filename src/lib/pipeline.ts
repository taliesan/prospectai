// Core pipeline for donor profiling — CODED PIPELINE
// No agent loops. Every step is coded orchestration + single LLM API calls.
//
// Architecture:
//   LinkedIn PDF parsing → Identity extraction → Query design (LLM, 1 call)
//   → Tavily bulk search (coded) → Page fetching (coded, concurrent)
//   → Screening + dedup (coded + LLM) → Tiering (coded)
//   → Fat extraction (Opus, 1 call) → Profile (Opus, 1 call) → Editorial (Opus, 1 call)
//   → Meeting guide (Sonnet, 1 call)

import Anthropic from '@anthropic-ai/sdk';
import { complete, conversationTurn, Message } from './anthropic';
import { STATUS } from './progress';
import {
  IDENTITY_EXTRACTION_PROMPT,
  generateResearchQueries,
  parseAnalyticalQueries,
} from './prompts/research';
import { buildExtractionPrompt, LinkedInData } from './prompts/extraction-prompt';
import { buildProfilePrompt } from './prompts/profile-prompt';
import { buildCritiqueRedraftPrompt } from './prompts/critique-redraft-prompt';
import { buildMeetingGuidePrompt, MEETING_GUIDE_SYSTEM_PROMPT } from './prompts/meeting-guide';
import { selectExemplars, loadExemplars, loadExemplarProfilesSeparate, loadGeoffreyBlock, loadMeetingGuideBlockV3, loadMeetingGuideExemplars, loadMeetingGuideOutputTemplate, loadDTWOrgLayer } from './canon/loader';
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

// Deep research (OpenAI o3-deep-research) — gap-fill only in v6 pipeline
import { DeepResearchResult, executeDeepResearch, validateResearchPackage, buildGapFillDeveloperMessage, buildGapFillUserMessage } from './research/deep-research';
import type { ActivityCallback } from './job-store';

// v5 pipeline modules
import { deduplicateSources } from './research/dedup';
import { runRelevanceFilter } from './research/relevance-filter';
import { runDimensionScoring, formatCoverageGapReport, formatSourcesForDeepResearch } from './prompts/source-scoring';
import { parseQueryGenerationResponse, generateSupplementaryQueryPrompt, type CategorizedQuery } from './prompts/research';

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
  const queryPrompt = generateResearchQueries(donorName, identity, seedContent.slice(0, 15000));
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
      rationale: `[Cat ${q.category}] ${q.rationale}`,
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
        const catMatch = q.rationale.match(/^\[Cat ([A-C])\]/);
        const queryCategory = catMatch ? catMatch[1] as 'A' | 'B' | 'C' : undefined;

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

  const screeningResult = await runScreeningPipeline(
    uniqueSources,
    donorName,
    identity
  );
  const screenedSources = screeningResult.survivingUrls;
  const screeningStats = screeningResult.stats;

  emit(`Screened: ${screeningStats.autoRejected} auto-rejected, ${screeningStats.pass1Killed + screeningStats.pass2Killed} LLM-rejected`, 'research', 12, TOTAL);

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
  console.log(`[Screening] LLM rejections: ${screeningStats.pass1Killed + screeningStats.pass2Killed}`);
  console.log(`[Screening] Surviving: ${screeningStats.surviving}`);
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

// ── Token estimation ──────────────────────────────────────────────
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ══════════════════════════════════════════════════════════════════════
// ARCHIVED: The following functions were moved to _archived/pipeline-legacy.ts:
//   screenSourcesForRelevance, rankSourceByBehavioralValue, rankAndSortSources,
//   extractEvidence, generateProfile, generateExtractionMarkdown, withTimeout, delay
// ══════════════════════════════════════════════════════════════════════

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
  onActivity?: ActivityCallback,
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

  // ── Research Provider Selection ──────────────────────────────────
  // RESEARCH_PROVIDER=openai    → v5 hybrid pipeline (Tavily breadth + Deep Research synthesis)
  // RESEARCH_PROVIDER=anthropic → Legacy Tavily pipeline (existing coded pipeline)
  const researchProvider = (process.env.RESEARCH_PROVIDER || 'openai').toLowerCase();
  console.log(`[Pipeline] Research provider: ${researchProvider}`);

  let research: ResearchResult;
  let researchPackage: string;
  let deepResearchResult: DeepResearchResult | null = null;

  if (researchProvider === 'openai') {
    // ═══════════════════════════════════════════════════════════════
    // v6 PIPELINE: Tavily→Screen→Score→DR gap-fill→Opus synthesis
    //
    // Stage 1:  Source Discovery + Screening (Tavily + Sonnet)
    // Stage 1b: Relevance Filter (Sonnet)
    // Stage 2:  Dimension Scoring & Selection (Sonnet, 80K budget)
    // Stage 3:  DR Gap-Fill (searches web, no raw sources)
    // Stage 4:  Opus Extraction + Synthesis (reads all sources + DR essay)
    // Stage 5:  Profile Generation (Opus)
    // Stage 5a: Fact-Check (Sonnet)
    // Stage 5b: Editorial Pass (Opus)
    // Stage 6:  Meeting Guide (Sonnet)
    // ═══════════════════════════════════════════════════════════════
    emit('', 'research');

    // ── Fetch seed URL content ────────────────────────────────────
    const actualFetchFunction = fetchFunction || executeFetchPage;
    let seedUrlContent: string | null = null;
    if (seedUrls.length > 0) {
      try {
        const domain = (() => { try { return new URL(seedUrls[0]).hostname.replace('www.', ''); } catch { return seedUrls[0]; } })();
        emit(`Reading seed URL — ${domain}`, 'research', 2, TOTAL_STEPS);
        seedUrlContent = await actualFetchFunction(seedUrls[0]);
        console.log(`[Pipeline] Fetched seed URL: ${seedUrls[0]} (${seedUrlContent.length} chars)`);
      } catch (err) {
        console.error(`[Pipeline] Failed to fetch seed URL: ${seedUrls[0]}`, err);
      }
    }

    // ── Stage 0: Identity extraction ─────────────────────────────
    let identity: any = { name: donorName, currentOrg: '', currentRole: '' };
    if (seedUrlContent) {
      emit('Identifying role, org, and key affiliations', 'research', 3, TOTAL_STEPS);
      try {
        const identityResponse = await complete('You are a research assistant.', `${IDENTITY_EXTRACTION_PROMPT}\n\nDonor Name: ${donorName}\n\nPAGE CONTENT:\n${seedUrlContent.slice(0, 15000)}\n\nExtract the identity signals for this person.`);
        const jsonMatch = identityResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          identity = JSON.parse(jsonMatch[0]);
          identity.name = identity.fullName || donorName;
        }
      } catch (err) {
        console.error('[Pipeline] Identity extraction failed:', err);
      }
    }
    // Enrich with LinkedIn data
    if (linkedinData) {
      identity.currentRole = linkedinData.currentTitle || identity.currentRole;
      identity.currentOrg = linkedinData.currentEmployer || identity.currentOrg;
      if (linkedinData.careerHistory?.length) {
        identity.pastRoles = linkedinData.careerHistory.map(j => ({
          role: j.title, org: j.employer, years: `${j.startDate} - ${j.endDate}`
        }));
      }
      if (linkedinData.education?.length) {
        identity.education = linkedinData.education.map(e => ({
          school: e.institution, degree: e.degree, year: e.years
        }));
      }
      if (linkedinData.boards?.length) {
        identity.affiliations = [...(identity.affiliations || []), ...linkedinData.boards];
      }
    }

    // ── Stage 1: Query Generation ────────────────────────────────
    if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
    emit(`Designing search strategy for ${donorName}`, 'research', 4, TOTAL_STEPS);
    console.log('[Stage 1] Generating search queries');

    const queryPrompt = generateResearchQueries(donorName, identity, seedUrlContent?.slice(0, 15000), linkedinData);
    const queryResponse = await complete('You are a research strategist designing search queries for behavioral evidence.', queryPrompt);
    const categorizedQueries = parseQueryGenerationResponse(queryResponse);

    const catCounts: Record<string, number> = {};
    for (const q of categorizedQueries) {
      catCounts[q.category] = (catCounts[q.category] || 0) + 1;
    }
    console.log(`[Stage 1] Generated ${categorizedQueries.length} queries: A=${catCounts['A'] || 0}, B=${catCounts['B'] || 0}, C=${catCounts['C'] || 0}`);
    emit(`${categorizedQueries.length} search queries designed (A:${catCounts['A'] || 0}, B:${catCounts['B'] || 0}, C:${catCounts['C'] || 0})`, 'research', 5, TOTAL_STEPS);

    // ── Stage 2: Search Execution ────────────────────────────────
    if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
    emit(`Executing ${categorizedQueries.length} searches`, 'research', 6, TOTAL_STEPS);
    console.log('[Stage 2] Executing searches');

    const allSearchSources: ResearchSource[] = [];
    const seenSearchUrls = new Set<string>();
    let searchedCount = 0;

    // Run searches in parallel (3 concurrent)
    const SEARCH_CONCURRENCY = 3;
    const searchPromises = new Set<Promise<void>>();

    for (const q of categorizedQueries) {
      const p = (async () => {
        try {
          const results = await searchFunction(q.query);
          for (const r of results) {
            // Cross-query URL dedup
            if (seenSearchUrls.has(r.url)) continue;
            seenSearchUrls.add(r.url);

            allSearchSources.push({
              url: r.url,
              title: r.title,
              snippet: r.snippet,
              content: (r as any).fullContent || (r as any).content || undefined,
              query: q.query,
              queryCategory: q.category as 'A' | 'B' | 'C',
              queryHypothesis: q.rationale,
              targetDimensions: q.targetDimensions,
              source: 'tavily',
            });
          }
        } catch (err) {
          console.error(`[Stage 2] Search failed: ${q.query}`, err);
        }
        searchedCount++;
        if (searchedCount % 10 === 0 || searchedCount === categorizedQueries.length) {
          emit(`Searched ${searchedCount}/${categorizedQueries.length} — ${allSearchSources.length} unique results`, 'research', 7, TOTAL_STEPS);
        }
      })().then(() => { searchPromises.delete(p); });
      searchPromises.add(p);
      if (searchPromises.size >= SEARCH_CONCURRENCY) {
        await Promise.race(searchPromises);
      }
    }
    await Promise.all(searchPromises);

    // Also add blog crawl sources (bypass screening)
    let tier1Sources: ResearchSource[] = [];
    if (fetchFunction) {
      try {
        tier1Sources = await crawlSubjectPublishing(donorName, seedUrls, linkedinData || identity, searchFunction as any, fetchFunction);
        console.log(`[Stage 2] Blog crawl: ${tier1Sources.length} sources`);
      } catch (err) {
        console.error('[Stage 2] Blog crawl failed:', err);
      }
    }

    const allSources = [...tier1Sources, ...allSearchSources];
    console.log(`[Stage 2] ${allSources.length} total sources (${tier1Sources.length} blog, ${allSearchSources.length} Tavily)`);
    emit(`${allSources.length} sources found — ${tier1Sources.length} blog posts, ${allSearchSources.length} from search`, 'research', 8, TOTAL_STEPS);

    // ── Stage 3: Screening & Attribution ─────────────────────────
    if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
    emit(`Screening ${allSources.length} sources for relevance`, 'research', 9, TOTAL_STEPS);
    console.log('[Stage 3] Running screening & attribution filter');

    const screeningResult = await runScreeningPipeline(allSources, donorName, identity, linkedinData);
    const screenedSources = screeningResult.survivingUrls;

    console.log(`[Stage 3] ${screenedSources.length} survived screening (${screeningResult.killedUrls.length} killed)`);
    emit(`${screenedSources.length} sources passed screening`, 'research', 10, TOTAL_STEPS);

    // ── DEBUG: Screening Audit Report ─────────────────────────────
    try {
      const screeningAudit: string[] = [
        `SCREENING AUDIT — ${donorName}`,
        `Generated: ${new Date().toISOString()}`,
        `Total input: ${allSources.length}`,
        `Surviving: ${screenedSources.length}`,
        `Killed: ${screeningResult.killedUrls.length}`,
        '',
        '=== SURVIVING SOURCES ===',
      ];
      for (const s of screenedSources) {
        const nameInSnippet = s.snippet?.toLowerCase().includes(donorName.toLowerCase()) ? 'YES' : 'NO';
        const nameInTitle = s.title?.toLowerCase().includes(donorName.toLowerCase()) ? 'YES' : 'NO';
        screeningAudit.push(
          `\n  URL: ${s.url}`,
          `  Title: ${s.title}`,
          `  Source: ${s.source || 'tavily'}`,
          `  Attribution: ${s.attribution || 'none'}`,
          `  Screened by LLM: ${s.screened === true ? 'YES' : s.screened === false ? 'NO (fail-open)' : 'unknown'}`,
          `  Bypass screening: ${s.bypassScreening ? 'YES' : 'no'}`,
          `  Query category: ${s.queryCategory || 'n/a'}`,
          `  Query: ${s.query || 'n/a'}`,
          `  Name in snippet: ${nameInSnippet}`,
          `  Name in title: ${nameInTitle}`,
          `  Snippet: ${(s.snippet || '').slice(0, 200)}`,
        );
      }
      screeningAudit.push('', '=== KILLED SOURCES ===');
      for (const k of screeningResult.killedUrls) {
        screeningAudit.push(`  ${k.url}  —  Pass ${k.pass}: ${k.killReason}`);
      }
      writeFileSync('/tmp/prospectai-outputs/DEBUG-screening-audit.txt', screeningAudit.join('\n'));
      console.log('[DEBUG] Wrote /tmp/prospectai-outputs/DEBUG-screening-audit.txt');
    } catch (e) { /* ignore */ }

    // ── Stage 4: Content Fetch + Dedup ───────────────────────────
    if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
    emit(`Fetching full content for ${screenedSources.length} sources`, 'research', 11, TOTAL_STEPS);
    console.log('[Stage 4] Fetching full content');

    // Bulk fetch sources lacking full content
    const sourcesToFetch = screenedSources.filter(s => !s.content || s.content.length < 200);
    console.log(`[Stage 4] Fetching ${sourcesToFetch.length} sources (${screenedSources.length - sourcesToFetch.length} already have content)`);

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
            emit(`Fetched ${fetchedCount}/${sourcesToFetch.length} pages`, 'research', 12, TOTAL_STEPS);
          }
        } catch (err) {
          console.log(`[Stage 4] Fetch failed: ${source.url}: ${err instanceof Error ? err.message : String(err)}`);
        }
      })().then(() => { executing.delete(p); });
      executing.add(p);
      if (executing.size >= FETCH_CONCURRENCY) {
        await Promise.race(executing);
      }
    }
    await Promise.all(executing);

    // Deduplication (LinkedIn overlap, URL normalization, content fingerprinting)
    const linkedinPostContents: string[] = [];
    // Extract LinkedIn post contents if available from blog crawl
    for (const s of tier1Sources) {
      if (s.source === 'linkedin_post' && s.content) {
        linkedinPostContents.push(s.content);
      }
    }
    const { deduplicated: dedupedSources } = deduplicateSources(screenedSources, linkedinPostContents);
    console.log(`[Stage 4] After dedup: ${dedupedSources.length} sources`);
    emit(`${dedupedSources.length} unique sources after dedup`, 'research', 13, TOTAL_STEPS);

    // ── Stage 4.5: Relevance Filter ─────────────────────────────
    // Defense in depth behind screening. Checks each source against
    // the target's career timeline and seed URL context.
    if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
    emit(`Relevance-checking ${dedupedSources.length} sources against career timeline`, 'research', 14, TOTAL_STEPS);
    console.log('[Stage 4.5] Running relevance filter');

    const relevanceResult = await runRelevanceFilter(
      dedupedSources,
      donorName,
      seedUrlContent || '',
      linkedinData,
      identity,
    );
    const relevantSources = relevanceResult.passed;

    console.log(`[Stage 4.5] ${relevantSources.length} passed relevance filter (${relevanceResult.failed.length} dropped, ${relevanceResult.stats.failOpenCount} fail-open)`);
    emit(`${relevantSources.length} sources passed relevance filter`, 'research', 14, TOTAL_STEPS);

    // Debug save relevance filter results
    try {
      const relLines: string[] = [
        `RELEVANCE FILTER REPORT — ${donorName}`,
        `Generated: ${new Date().toISOString()}`,
        `Input: ${dedupedSources.length} | Passed: ${relevantSources.length} | Failed: ${relevanceResult.failed.length} | Fail-open: ${relevanceResult.stats.failOpenCount}`,
        '',
        '=== FAILED SOURCES ===',
      ];
      for (const f of relevanceResult.failed) {
        relLines.push(`  DROPPED: ${f.url}`);
        relLines.push(`    Title: ${f.title}`);
        relLines.push(`    Reason: ${f.reason}`);
        relLines.push('');
      }
      relLines.push('', '=== PASSED SOURCES ===');
      for (const s of relevantSources) {
        relLines.push(`  KEPT: ${s.url}`);
        relLines.push(`    Attribution: ${s.attribution || 'none'} | Screened: ${s.screened} | Bypass: ${s.bypassScreening || false}`);
        relLines.push('');
      }
      writeFileSync('/tmp/prospectai-outputs/DEBUG-relevance-filter.txt', relLines.join('\n'));
      console.log('[DEBUG] Wrote /tmp/prospectai-outputs/DEBUG-relevance-filter.txt');
    } catch (e) { /* ignore */ }

    // ── Stage 5: Dimension Scoring & Selection ───────────────────
    if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
    emit(`Scoring ${relevantSources.length} sources against 25 dimensions`, 'research', 15, TOTAL_STEPS);
    console.log('[Stage 5] Dimension scoring & selection');

    const stage5Result = await runDimensionScoring(relevantSources, donorName, identity, linkedinData);
    const selectedSources = stage5Result.selectedSources;
    const coverageGapReport = formatCoverageGapReport(stage5Result.coverageGaps);

    console.log(`[Stage 5] Selected ${selectedSources.length} sources (~${stage5Result.stats.estimatedContentChars} chars)`);
    emit(`${selectedSources.length} sources selected for synthesis (~${Math.round(stage5Result.stats.estimatedContentChars / 1000)}K chars)`, 'research', 15, TOTAL_STEPS);

    // ── DEBUG: Source Selection Provenance Report ──────────────────
    // Shows every source that will reach Deep Research, with a
    // name-in-content check to flag potential off-target leaks.
    try {
      const nameLower = donorName.toLowerCase();
      const nameParts = donorName.trim().split(/\s+/);
      const lastName = nameParts[nameParts.length - 1]?.toLowerCase() || '';

      const provLines: string[] = [
        `SOURCE SELECTION PROVENANCE — ${donorName}`,
        `Generated: ${new Date().toISOString()}`,
        `Selected: ${selectedSources.length} of ${stage5Result.stats.totalScored} scored`,
        `Total content: ~${Math.round(stage5Result.stats.estimatedContentChars / 1000)}K chars`,
        `Budget: ${100_000} chars`,
        '',
      ];

      let suspectCount = 0;
      for (let i = 0; i < selectedSources.length; i++) {
        const s = selectedSources[i];
        const content = (s.content || '').toLowerCase();
        const nameInContent = content.includes(nameLower);
        const lastNameInContent = lastName ? content.includes(lastName) : false;

        // Flag as suspect if neither full name nor last name appears in content
        const suspect = !nameInContent && !lastNameInContent;
        if (suspect) suspectCount++;

        // Dimension coverage summary
        const dimEntries = Object.entries(s.depth_scores)
          .filter(([, score]) => score > 0)
          .sort(([, a], [, b]) => b - a);
        const dimSummary = dimEntries.length > 0
          ? dimEntries.map(([d, score]) => `${d}:${score}`).join(' ')
          : 'ALL ZEROS';
        const totalDepth = dimEntries.reduce((sum, [, score]) => sum + score, 0);

        // Find original source metadata from screenedSources
        const origSource = screenedSources.find(sc => sc.url === s.url);

        provLines.push(
          `${suspect ? '*** SUSPECT ***' : ''} SOURCE ${i + 1}/${selectedSources.length}`,
          `  URL: ${s.url}`,
          `  Title: ${s.title}`,
          `  Tier: ${s.sourceTier}`,
          `  Attribution: ${s.attribution || 'none'}`,
          `  Content length: ${(s.content || '').length} chars`,
          `  Name in content: ${nameInContent ? 'YES (full)' : lastNameInContent ? 'YES (last name only)' : '*** NO ***'}`,
          `  Provenance: ${origSource?.source || 'unknown'}`,
          `  Screened: ${origSource?.screened === true ? 'YES' : origSource?.screened === false ? 'FAIL-OPEN' : 'unknown'}`,
          `  Bypass screening: ${origSource?.bypassScreening ? 'YES' : 'no'}`,
          `  Query: ${origSource?.query || 'n/a'}`,
          `  Query category: ${origSource?.queryCategory || 'n/a'}`,
          `  Depth scores (${dimEntries.length} dims, total=${totalDepth}): ${dimSummary}`,
          '',
        );
      }

      // Summary header
      provLines.splice(5, 0,
        `SUSPECT SOURCES (name not in content): ${suspectCount}`,
        suspectCount > 0 ? '^^^ These sources likely have nothing to do with the target donor ^^^' : '',
      );

      // Not-selected sources summary
      provLines.push('', '=== NOT SELECTED ===');
      for (const ns of stage5Result.notSelected.slice(0, 30)) {
        provLines.push(`  ${ns.url}  —  ${ns.reason}`);
      }
      if (stage5Result.notSelected.length > 30) {
        provLines.push(`  ... and ${stage5Result.notSelected.length - 30} more`);
      }

      // Coverage gap summary
      provLines.push('', '=== COVERAGE GAP REPORT ===', coverageGapReport);

      writeFileSync('/tmp/prospectai-outputs/DEBUG-source-selection.txt', provLines.join('\n'));
      console.log(`[DEBUG] Wrote /tmp/prospectai-outputs/DEBUG-source-selection.txt (${suspectCount} suspect sources)`);
      if (suspectCount > 0) {
        console.warn(`[Stage 5] *** ${suspectCount} selected sources do NOT mention "${donorName}" in content ***`);
      }
    } catch (e) { /* ignore */ }

    // ── Stage 3 (DR Gap-Fill): Search web for evidence Tavily missed ──
    if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
    emit('Launching gap-fill web search for thin dimensions', 'research', 16, TOTAL_STEPS);
    console.log('[Stage 3/DR] Running DR gap-fill (no raw sources — gap report + LinkedIn only)');

    // ── DEBUG: Source Packet Manifest ─────────────────────────────
    try {
      const manifestLines: string[] = [
        `SOURCE PACKET MANIFEST — ${donorName}`,
        `Generated: ${new Date().toISOString()}`,
        `Selected sources: ${selectedSources.length}`,
        `Total content: ~${Math.round(stage5Result.stats.estimatedContentChars / 1000)}K chars`,
        '',
        'Sources ranked by scarcity-weighted scoring within 80K char budget.',
        'These go to Opus extraction+synthesis, NOT to DR.',
        '',
      ];
      const nameLower = donorName.toLowerCase();
      const lastNameLower = donorName.trim().split(/\s+/).pop()?.toLowerCase() || '';
      for (let i = 0; i < selectedSources.length; i++) {
        const s = selectedSources[i];
        const content = s.content || '';
        const nameHit = content.toLowerCase().includes(nameLower)
          ? 'FULL NAME'
          : content.toLowerCase().includes(lastNameLower)
            ? 'LAST NAME ONLY'
            : '*** ABSENT ***';
        manifestLines.push(
          `--- SOURCE ${i + 1} ---`,
          `URL: ${s.url}`,
          `Title: ${s.title}`,
          `Tier: ${s.sourceTier}  |  Attribution: ${s.attribution || 'none'}`,
          `Content length: ${content.length} chars  |  Name check: ${nameHit}`,
          `Content preview: ${content.slice(0, 300).replace(/\n/g, ' ')}`,
          '',
        );
      }
      writeFileSync('/tmp/prospectai-outputs/DEBUG-source-packet-manifest.txt', manifestLines.join('\n'));
      console.log('[DEBUG] Wrote /tmp/prospectai-outputs/DEBUG-source-packet-manifest.txt');
    } catch (e) { /* ignore */ }

    // Build DR gap-fill messages (no raw source text — only gap report + LinkedIn)
    const linkedinJson = linkedinData
      ? JSON.stringify({
        currentTitle: linkedinData.currentTitle,
        currentEmployer: linkedinData.currentEmployer,
        linkedinSlug: linkedinData.linkedinSlug,
        websites: linkedinData.websites,
        careerHistory: linkedinData.careerHistory,
        education: linkedinData.education,
        boards: linkedinData.boards,
      }, null, 2)
      : 'No LinkedIn data available';

    const drGapFillDevMsg = buildGapFillDeveloperMessage(donorName, coverageGapReport, linkedinJson);
    const drGapFillUserMsg = buildGapFillUserMessage(
      donorName,
      linkedinData?.currentTitle || identity.currentRole || '',
      linkedinData?.currentEmployer || identity.currentOrg || '',
    );

    // Debug save DR messages
    try {
      writeFileSync('/tmp/prospectai-outputs/DEBUG-dr-gapfill-developer-msg.txt', drGapFillDevMsg);
      writeFileSync('/tmp/prospectai-outputs/DEBUG-gap-report.txt', coverageGapReport);
    } catch (e) { /* ignore */ }

    const drResult = await executeDeepResearch(
      donorName,
      drGapFillDevMsg,
      drGapFillUserMsg,
      emit,
      abortSignal,
      onActivity,
      20, // max 20 web searches
    );
    deepResearchResult = {
      ...drResult,
      researchStrategy: 'v6-gap-fill-only',
    };

    const gapFillEssay = drResult.dossier;
    console.log(`[Stage 3/DR] Gap-fill complete: ${gapFillEssay.length} chars, ${drResult.searchCount} searches`);

    // Debug save DR output
    try {
      writeFileSync('/tmp/prospectai-outputs/DEBUG-dr-gapfill-output.txt', gapFillEssay);
    } catch (e) { /* ignore */ }

    emit(`Gap-fill found ${deepResearchResult.searchCount} new sources — launching Opus synthesis`, 'research', 18, TOTAL_STEPS);

    // ── Stage 4 (Opus Extraction + Synthesis): One call reads everything ──
    if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
    console.log('[Stage 4/Opus] Running Opus extraction + synthesis');

    const sourcesFormatted = formatSourcesForDeepResearch(selectedSources);
    const sourceCharsK = Math.round(sourcesFormatted.length / 1000);
    const gapFillCharsK = Math.round(gapFillEssay.length / 1000);
    console.log(`[Stage 4/Opus] Input: ${sourceCharsK}K chars pre-fetched sources + ${gapFillCharsK}K chars gap-fill essay`);

    const opusSynthesisSystemMsg = `You are a behavioral research analyst producing a comprehensive analytical dossier on ${donorName}. Your dossier will be the sole evidence base for a persuasion profile that predicts how this person behaves in meetings, what activates them, what shuts them down, and how to move them from interested to committed.

The profile writer who receives your dossier cannot access the original sources. Everything they need must be in your output. If you skip a source, that evidence is lost. If you skip a dimension, the profile will have a hole. If you write analysis without quotes to support it, the profile writer has no way to verify your claims.

You will receive:
- Pre-fetched source material — articles, essays, interviews, institutional content,
  press coverage — selected for maximum behavioral signal. Each source is labeled
  with its attribution type (target_authored, target_coverage, or
  institutional_inference) and its source URL.
- A supplementary research essay produced by a research agent that searched the web
  for evidence on dimensions where initial source discovery found gaps.
- The target's career history (LinkedIn JSON).
- A coverage gap report showing which dimensions need extra attention.
- A dimensional framework with 25 behavioral dimensions.

═══════════════════════════════════════════════
CRITICAL RULES
═══════════════════════════════════════════════

RULE 1 — ATTRIBUTION TAGS ARE MANDATORY.
Every quote you extract must carry its attribution type from the source header:
  - target_authored — written or spoken by the target in their own voice
  - target_coverage — written about the target by a journalist, colleague, or observer
  - institutional_inference — drawn from organizational documents, grant databases,
    press releases, or institutional records where the target is mentioned

These tags tell the profile writer how much weight to give each quote. A target's own words are direct evidence of how they think. A colleague's description is secondhand. An institutional document is circumstantial. The profile writer MUST be able to distinguish these. Copy the attribution type from each source's header exactly.

RULE 2 — SUPPLEMENTARY RESEARCH IS NOT A PRIMARY SOURCE.
The supplementary research essay was written by an AI research agent. It contains two kinds of content:
  a) QUOTED PASSAGES from actual web sources the agent found. These are real
     evidence. Extract them, tag them with the source URL the agent cites, and
     classify their attribution type based on the content.
  b) ANALYTICAL SENTENCES the agent wrote — inferences, summaries, speculations.
     These are NOT evidence. Do NOT extract them as quotes. Do NOT treat
     "MacDougall appears to value X" or "His success implies Y" as quotable
     material. The agent's analytical claims are hypotheses for you to evaluate
     against primary source evidence, not facts to include in the dossier.

When you cite supplementary research, cite only the actual quoted passages with their original source URLs. Never cite the research agent's own analytical prose as evidence.

RULE 3 — EVERY SOURCE MUST BE ACCOUNTED FOR.
You will receive N pre-fetched sources. Every one was selected because it contains behavioral signal. Your dossier must cite every source at least once. If a source seems thin, extract what it has and note its limitations. "This source only confirms what we already know from [other source]" is acceptable. Silently skipping a source is not.

At the end of your dossier, list every source URL and whether you cited it.

═══════════════════════════════════════════════
YOUR TASK — THREE PHASES
═══════════════════════════════════════════════

Work through three phases in sequence. All three phases appear in your output as a single structured document following the OUTPUT TEMPLATE below.

PHASE 1 — EXTRACTION.
Read every source completely. For each source, identify every passage (50–300 words) that reveals behavioral evidence — how this person makes decisions, what they value when values conflict, how they communicate, what activates or shuts them down, how they relate to power, money, risk, time, and people.

Map each passage to one or more of the 25 dimensions. Rate each passage:
  - Depth 1 = Mention — a fact without behavioral detail
  - Depth 2 = Passage — a paragraph describing a decision/action with context
  - Depth 3 = Rich evidence — direct quotes showing how they think, behavior
    under pressure, or observable interpersonal dynamics

Carry the attribution tag from the source header onto every extracted quote.

PHASE 2 — CROSS-SOURCE ANALYSIS.
For each of the 25 dimensions, examine all extracted evidence together and write two structured blocks:

ANALYSIS (labeled "CROSS-SOURCE PATTERN:"):
What appears across multiple sources. What's consistent. Where stated values diverge from revealed behavior. Where philosophical language conflicts with operational practice. Say/do gaps. Tensions between sources. What can't be known from available evidence (evidence ceilings).

Write in behavioral register: what the behavior looks like in the room. Not personality descriptions. Not adjectives about character. What someone across the table would see, hear, and feel — and what they should do about it.

CONDITIONAL:
Explicit if/then behavioral forks for this dimension. Both branches, with evidence for each. Format:
  "If you [do X], expect [Y] — [evidence]. If you [do not-X], expect [Z]
  — [evidence]."

These conditional forks are the most actionable content in the dossier. The profile writer will translate them directly into the behavioral forks and meeting choreography sections. Make them specific. Make them evidence-based. Make them predictive.

For dimensions with thin evidence, say so explicitly. Do not inflate thin evidence into confident claims. "Only one source addresses this, and it suggests X, but we can't confirm the pattern" is the right register.

PHASE 3 — SYNTHESIS FLAGS.
Identify the 3–5 most important cross-dimensional patterns — tensions and contradictions that span multiple dimensions and predict how this person will behave in a meeting. Each flag should:
- Connect at least 3 dimensions
- Contain a genuine tension or paradox (not just a theme)
- Predict specific observable behavior
- State what it means for someone trying to work with this person

One of these flags should be the KILLER INSIGHT — the single most important thing about this person that, if you understand it, restructures everything else. The thing that makes the profile's reader say "now I understand who I'm sitting across from." Name it first.

These synthesis flags drive the profile's architecture. The profile writer will build Section 1 around the killer insight and structure the remaining sections around the other flags. They are the highest-value output of your analysis.

═══════════════════════════════════════════════
OUTPUT TEMPLATE
═══════════════════════════════════════════════

Produce your dossier using the following structure exactly. Text in [BRACKETS] is generated content. Everything else — headers, labels, structural markers — must appear verbatim. Do not omit any section. Do not reorder dimensions. Do not skip the CONDITIONAL block for any dimension.

For each of the 25 dimensions, output:

[DIMENSION_NAME]
QUOTES:
    - [attribution_type] ([source_name_or_description]): "[Quoted passage — 50-300 words.
      Bold the most behaviorally revealing sentence or phrase within the quote.]"
      ([source_url])
    - [attribution_type] ([source_name_or_description]): "[Next quoted passage.]"
      ([source_url])
    [... additional quotes as warranted by investment tier ...]
ANALYSIS:
CROSS-SOURCE PATTERN: [Analytical paragraph. What patterns appear across multiple sources. What's consistent. Where stated values diverge from revealed behavior. Say/do gaps. Tensions between sources. Write in behavioral register — what someone across the table would see, hear, and feel. Note evidence ceilings inline as [EVIDENCE CEILING: description].]
CONDITIONAL: [If/then behavioral forks. Both branches with evidence. "If you [do X], expect [Y] — [brief evidence citation]. If you [do not-X], expect [Z] — [brief evidence citation]." Multiple forks per dimension are encouraged for HIGH and MEDIUM tier dimensions.]

After all 25 dimensions, append:

## SYNTHESIS FLAGS

### Flag 1: [KILLER INSIGHT — short name]
Dimensions: [comma-separated list of connected dimensions]
Pattern: [2-4 sentences describing the cross-dimensional tension or paradox]
Prediction: [2-3 sentences on what this predicts about observable behavior in a meeting — what someone across the table would see]
Implication: [1-2 sentences on what this means for someone trying to work with this person]

### Flag 2: [short name]
Dimensions: [list]
Pattern: [description]
Prediction: [observable behavior]
Implication: [what to do about it]

### Flag 3: [short name]
[same structure]

[... up to 5 flags total ...]

## SOURCE COVERAGE AUDIT

| # | Source URL | Cited | Notes |
|---|-----------|-------|-------|
| 1 | [url] | [YES/NO] | [brief note if NO — why skipped or what was thin] |
| 2 | [url] | [YES/NO] | [note] |
[... all N pre-fetched sources ...]
| S | Supplementary research | [YES/NO] | [what was extracted vs. what was agent inference] |

═══════════════════════════════════════════════
HARD CONSTRAINTS
═══════════════════════════════════════════════

- Every dimension gets QUOTES + ANALYSIS + CONDITIONAL. No exceptions.
- Every quote carries an attribution tag: target_authored, target_coverage,
  or institutional_inference. No untagged quotes.
- HIGH tier dimensions: minimum 5 quotes. MEDIUM: minimum 3. LOW: minimum 1.
  If evidence falls short, say so in the analysis — do not pad with thin material
  or agent inferences.
- CONDITIONAL blocks contain at least one if/then fork per dimension. HIGH tier
  dimensions should have 2-4 forks.
- Synthesis flags connect at least 3 dimensions each. Flag 1 is always the
  KILLER INSIGHT.
- The source coverage audit lists every pre-fetched source. 100% citation is
  the target. Any uncited source requires an explanation.
- Supplementary research: cite only actual quoted passages from real sources.
  Never cite the research agent's own analytical sentences as evidence.
- Bold the most behaviorally revealing phrase within each quote. This tells the
  profile writer where the signal is densest.
- [EVIDENCE CEILING] markers appear inline in ANALYSIS blocks wherever inference
  exceeds what the sources can support.

═══════════════════════════════════════════════
WHAT MAKES A GREAT DOSSIER vs. A MEDIOCRE ONE
═══════════════════════════════════════════════

GREAT: "CROSS-SOURCE PATTERN: He built his entire fund philosophy around the idea that openness creates trust faster than polish or secrecy. He open-sourced internal processes, created anonymous feedback channels for founders, and wrote publicly about taboo topics in VC. A 20-year colleague describes him as a 'student of human nature' whose people-reads are reliable. But his default mode is to question quickly and directly — which can feel like criticism if you're not prepared."

This is great because it synthesizes across 4 sources, identifies a tension (openness vs. aggressive questioning), and describes what someone would experience in the room.

MEDIOCRE: "MacDougall values transparency and openness in his work. He has been praised for making complex things simple. He appears to be someone who builds trust through authenticity."

This is mediocre because it's personality description, not behavioral prediction. It uses adjectives instead of observable behavior. It doesn't synthesize across sources or identify tensions. Nobody can act on it.

GREAT CONDITIONAL: "If you lead with transparency about your problems and uncertainties, he'll lean in — that's his language (Bloomberg Beta Manual: 'transparency is the first step to trust'). If you lead with polish and manage impressions, he'll start questioning and the dynamic will shift to interrogation (anti-sell document: 'quick to question — often comes across as criticism')."

This is great because both branches are evidence-based, predict observable behavior, and tell the reader what to do.

MEDIOCRE CONDITIONAL: "If you are honest with him, he will respond well. If you are not honest, he may disengage."

This is mediocre because it could describe anyone. There's no evidence, no specificity, no observable behavior.

═══════════════════════════════════════════════
BEHAVIORAL DIMENSIONS
═══════════════════════════════════════════════

HIGH INVESTMENT (target: 7+ quotes):

1. DECISION_MAKING — How they evaluate proposals and opportunities. Speed of
    decisions, gut vs analysis, what triggers yes/no.

2. TRUST_CALIBRATION — What builds or breaks credibility. Verification behavior,
    skepticism triggers.

3. COMMUNICATION_STYLE — Language patterns, directness, framing, how they explain.

4. IDENTITY_SELF_CONCEPT — How they see and present themselves. Origin story,
    identity markers.

5. VALUES_HIERARCHY — What they prioritize when values conflict. Trade-off decisions.

6. CONTRADICTION_PATTERNS — Inconsistencies between stated and revealed preferences.
    Say/do gaps. MOST IMPORTANT — contradictions reveal where persuasion has
    maximum leverage.

7. POWER_ANALYSIS — How they read, navigate, and deploy power. Their implicit
    theory of how institutions actually work vs. how they're supposed to work.

MEDIUM INVESTMENT (target: 5+ quotes):

8. INFLUENCE_SUSCEPTIBILITY — What persuades them, who they defer to, resistance
    patterns.
9. TIME_ORIENTATION — Past/present/future emphasis, patience level, urgency triggers.
10. BOUNDARY_CONDITIONS — Hard limits and non-negotiables. Explicit red lines.
11. EMOTIONAL_TRIGGERS — What excites or irritates them. Energy shifts, enthusiasm
    spikes.
12. RELATIONSHIP_PATTERNS — How they engage with people. Loyalty, collaboration style.
13. RISK_TOLERANCE — Attitude toward uncertainty and failure. Bet-sizing, hedging.
14. RESOURCE_PHILOSOPHY — How they think about money, time, leverage.
15. COMMITMENT_PATTERNS — How they make and keep commitments. Escalation, exit
    patterns.

LOW INVESTMENT (target: 2+ quotes):
16. LEARNING_STYLE — How they take in new information.
17. STATUS_RECOGNITION — How they relate to prestige and credit.
18. KNOWLEDGE_AREAS — Domains of expertise and intellectual passion.
19. RETREAT_PATTERNS — How they disengage, recover, reset.
20. SHAME_DEFENSE_TRIGGERS — What they protect, what feels threatening.
21. REAL_TIME_INTERPERSONAL_TELLS — Observable behavior in interaction.
22. TEMPO_MANAGEMENT — Pacing of decisions, conversations, projects.
23. HIDDEN_FRAGILITIES — Vulnerabilities they manage or compensate for.
24. RECOVERY_PATHS — How they bounce back from setbacks.
25. CONDITIONAL_BEHAVIORAL_FORKS — When X happens, they do Y. When not-X, they do Z.`;

    const opusSynthesisUserMsg = `TARGET: ${donorName}

CAREER HISTORY:
${linkedinJson}

COVERAGE GAP REPORT FROM PRE-RESEARCH:
${coverageGapReport}

══════════════════════════════════════════
PRE-FETCHED SOURCES (${selectedSources.length} sources, ~${sourceCharsK}K chars)
══════════════════════════════════════════

${sourcesFormatted}

══════════════════════════════════════════
SUPPLEMENTARY RESEARCH (gap-fill findings)
══════════════════════════════════════════

The following analysis was produced by a research agent that searched the web for evidence on dimensions that were underserved by the pre-fetched sources. Treat this as another source — extract what's useful, note what's thin, integrate it into your cross-source analysis.

${gapFillEssay}`;

    // Debug save Opus messages
    try {
      writeFileSync('/tmp/prospectai-outputs/DEBUG-opus-synthesis-system-msg.txt', opusSynthesisSystemMsg);
      // Truncate user msg for debug if huge
      const userMsgDebug = opusSynthesisUserMsg.length > 10000
        ? opusSynthesisUserMsg.slice(0, 2000) + `\n\n... [TRUNCATED — ${opusSynthesisUserMsg.length} chars total] ...\n\n` + opusSynthesisUserMsg.slice(-2000)
        : opusSynthesisUserMsg;
      writeFileSync('/tmp/prospectai-outputs/DEBUG-opus-synthesis-user-msg.txt', userMsgDebug);
    } catch (e) { /* ignore */ }

    console.log(`[Stage 4/Opus] System msg: ${opusSynthesisSystemMsg.length} chars, User msg: ${opusSynthesisUserMsg.length} chars`);
    console.log(`[Stage 4/Opus] Total input: ~${Math.round((opusSynthesisSystemMsg.length + opusSynthesisUserMsg.length) / 4)} tokens`);

    emit('Opus reading all sources and producing analytical dossier...', 'research', 19, TOTAL_STEPS);

    // Stream Opus extraction+synthesis
    const opusSynthesisStream = anthropic.messages.stream({
      model: 'claude-opus-4-20250514',
      max_tokens: 32000,
      system: opusSynthesisSystemMsg,
      messages: [{ role: 'user', content: opusSynthesisUserMsg }],
    }, abortSignal ? { signal: abortSignal } : undefined);

    researchPackage = '';
    let lastSynthesisProgress = Date.now();
    opusSynthesisStream.on('text', (text) => {
      researchPackage += text;
      const now = Date.now();
      if (now - lastSynthesisProgress > 30_000) {
        const tokens = estimateTokens(researchPackage);
        emit(`Opus synthesis in progress — ${tokens} tokens so far...`, 'research', 19, TOTAL_STEPS);
        lastSynthesisProgress = now;
      }
    });
    await opusSynthesisStream.finalMessage();

    console.log(`[Stage 4/Opus] Dossier complete: ${researchPackage.length} chars (~${estimateTokens(researchPackage)} tokens)`);

    // Debug save research package
    try {
      writeFileSync('/tmp/prospectai-outputs/DEBUG-research-package.txt', researchPackage);
    } catch (e) { /* ignore */ }

    // Validate research package quality
    const validationChecks = validateResearchPackage(researchPackage, selectedSources.length);
    console.log(`[Stage 4/Opus] Validation: length=${validationChecks.length}, sources_cited=${validationChecks.uniqueSourcesCited}/${validationChecks.sourcesExpected}, conditionals=${validationChecks.conditionals}/25, cross_source=${validationChecks.crossSourcePatterns}/25, attribution_tags=${validationChecks.attributionTags}, synthesis_flags=${validationChecks.synthesisFlags}, coverage_audit=${validationChecks.hasCoverageAudit ? 'yes' : 'no'}`);

    // Create ResearchResult for compatibility
    research = {
      donorName,
      identity,
      queries: categorizedQueries.map(q => ({
        query: q.query,
        tier: q.category === 'A' ? 'STANDARD' as const : 'TAILORED' as const,
        rationale: `[Cat ${q.category}] ${q.rationale}`,
      })),
      sources: selectedSources.map(s => ({
        url: s.url,
        title: s.title,
        snippet: (s.content || '').slice(0, 200),
      })),
      rawMarkdown: `# v6 RESEARCH DOSSIER: ${donorName}\n\nPipeline: v6 (Tavily + DR gap-fill + Opus synthesis)\nQueries: ${categorizedQueries.length}\nScreened: ${screenedSources.length}/${allSources.length}\nRelevance-filtered: ${relevantSources.length}/${dedupedSources.length}\nSelected for Opus: ${selectedSources.length} (~${sourceCharsK}K chars)\nDR gap-fill searches: ${deepResearchResult.searchCount}\nDR gap-fill essay: ${gapFillCharsK}K chars\nOpus dossier: ${researchPackage.length} chars\n\n${researchPackage}`,
    };

    console.log(`\n[Pipeline] v6 research complete: ${deepResearchResult.searchCount} gap-fill searches, ${researchPackage.length} char dossier\n`);
    STATUS.researchComplete(deepResearchResult.searchCount);
    emit(`Opus dossier ready — ${estimateTokens(researchPackage)} tokens`, 'analysis', 20, TOTAL_STEPS);
    STATUS.researchPackageComplete();

  } else {
    // ═══════════════════════════════════════════════════════════════
    // LEGACY TAVILY PIPELINE: conductResearch → fat extraction (Opus)
    // ═══════════════════════════════════════════════════════════════
    emit('', 'research');
    emit(`Collecting sources for ${donorName}`, 'research', 3, TOTAL_STEPS);

    const actualFetchFunction = fetchFunction || executeFetchPage;

    research = await conductResearch(
      donorName,
      seedUrls,
      searchFunction,
      actualFetchFunction,
      emit,
      linkedinData,
    );
    console.log(`\n[Pipeline] Research complete: ${research.sources.length} sources\n`);
    STATUS.researchComplete(research.sources.length);

    // ── Fat Extraction (Opus, single call) ──────────────────────
    emit('', 'analysis');
    emit('Producing behavioral evidence extraction (Opus, single call)', 'analysis', 16, TOTAL_STEPS);
    console.log(`[Pipeline] Fat extraction — ${research.sources.length} sources to Opus`);

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

    researchPackage = '';
    let lastProgressUpdate = Date.now();
    extractionStream.on('text', (text) => {
      researchPackage += text;
      const now = Date.now();
      if (now - lastProgressUpdate > 30_000) {
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
  }

  // ── Step 3: Profile Generation (Opus, Geoffrey Block) ───────────
  if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
  emit('Writing Persuasion Profile from behavioral evidence', 'analysis', 22, TOTAL_STEPS);
  console.log('[Pipeline] Step 3: Profile generation (Opus)');

  const geoffreyBlock = loadGeoffreyBlock();
  const exemplars = loadExemplars();

  const researchPackagePreamble = deepResearchResult
    ? `The behavioral evidence below is an analytical dossier produced by Opus reading ${research.sources.length} pre-fetched sources in full plus a supplementary gap-fill research essay (${deepResearchResult.searchCount} additional web searches). Each behavioral dimension contains two blocks:

QUOTES — the subject's own words and direct evidence from sources. These are your primary evidence. Build your behavioral claims from what the subject actually said and did, not from the research analyst's interpretation of what they said and did.

ANALYSIS — cross-source analytical commentary on the quotes. This commentary identifies patterns, contradictions, conditional forks, and evidence ceilings. It is a first read — useful as a starting hypothesis, but not authoritative. When the commentary and a quote point in different directions, follow the quote. When the commentary describes a personality trait or uses academic language ("suggests a pattern of," "indicates a relationship style"), look past it to the quote underneath for the behavioral pattern you can actually deploy in a meeting.

The quotes are your evidence. The analysis is scaffolding. Build from the evidence.\n\n`
    : `The behavioral evidence below was curated from ${research.sources.length} source pages by an extraction model that read every source in full. Entries preserve the subject's original voice, surrounding context, and source shape.\n\n`;
  const extractionForProfile = researchPackagePreamble + researchPackage;

  const profilePromptText = buildProfilePrompt(donorName, extractionForProfile, geoffreyBlock, exemplars, linkedinData);
  console.log(`[Profile] Prompt size: ${estimateTokens(profilePromptText)} tokens`);

  // Debug save
  try {
    writeFileSync('/tmp/prospectai-outputs/DEBUG-prompt.txt', profilePromptText);
  } catch (e) { /* ignore */ }

  // Stream profile generation on Opus (same pattern as extraction)
  const profileStream = anthropic.messages.stream({
    model: 'claude-opus-4-20250514',
    max_tokens: 16000,
    system: 'You are writing a donor persuasion profile.',
    messages: [{ role: 'user', content: profilePromptText }],
  }, abortSignal ? { signal: abortSignal } : undefined);

  let firstDraftProfile = '';
  let lastProfileProgress = Date.now();
  profileStream.on('text', (text) => {
    firstDraftProfile += text;
    const now = Date.now();
    if (now - lastProfileProgress > 30_000) {
      const tokens = estimateTokens(firstDraftProfile);
      emit(`Profile draft in progress — ${tokens} tokens so far...`, 'analysis', 22, TOTAL_STEPS);
      lastProfileProgress = now;
    }
  });
  await profileStream.finalMessage();
  console.log(`[Profile] First draft: ${firstDraftProfile.length} chars`);

  try {
    writeFileSync('/tmp/prospectai-outputs/DEBUG-profile-first-draft.txt', firstDraftProfile);
  } catch (e) { /* ignore */ }

  // ── Step 3a: Fact-Check (Sonnet) ────────────────────────────────
  // Catches exemplar contamination, hallucinated specifics, and
  // unsupported claims before the editorial pass can bake them in.
  if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
  emit('Fact-checking first draft against sources...', 'analysis', 24, TOTAL_STEPS);
  console.log(`[Fact-Check] Starting: first draft ${firstDraftProfile.length} chars, research package ${researchPackage.length} chars, 3 exemplars`);

  let factCheckResult: any = null;
  let factCheckBlock = '';

  try {
    const exemplarProfiles = loadExemplarProfilesSeparate();
    const linkedinJSON = linkedinData ? JSON.stringify(linkedinData, null, 2) : 'No LinkedIn data available.';

    const factCheckUserMessage = `<fact_check_input>
<first_draft>
${firstDraftProfile}
</first_draft>

<research_package>
${researchPackage}
</research_package>

<canonical_biographical_data>
${linkedinJSON}
</canonical_biographical_data>

<exemplar_profiles>

=== EXEMPLAR PROFILE: ROY BAHAT (NOT the profiling target) ===
${exemplarProfiles.bahat}

=== EXEMPLAR PROFILE: CRAIG NEWMARK (NOT the profiling target) ===
${exemplarProfiles.newmark}

=== EXEMPLAR PROFILE: LORI McGLINCHEY (NOT the profiling target) ===
${exemplarProfiles.mcglinchey}

</exemplar_profiles>
</fact_check_input>`;

    console.log(`[Fact-Check] Prompt size: ~${estimateTokens(factCheckUserMessage)} tokens`);

    const factCheckResponse = await complete(
      `You are a fact-checker for donor persuasion profiles. Your job is to extract every specific factual claim from a draft profile and verify it against the evidence.

You will receive:
1. FIRST DRAFT — the profile text to verify
2. RESEARCH PACKAGE — the only permitted source of facts about this person
3. CANONICAL BIOGRAPHICAL DATA — LinkedIn career history (authoritative for dates, titles, employers)
4. EXEMPLAR PROFILES — profiles of OTHER donors (Bahat, Newmark, McGlinchey) used as writing examples. NO facts from these profiles should appear in the draft.

## What counts as a "specific factual claim"

Extract any statement containing:
- A number (dollar amounts, counts, percentages, years, durations)
- A named person, organization, or event
- A direct quote or attributed paraphrase
- A specific behavioral pattern presented as observed fact (not analytical inference)
- A career event or biographical detail
- A characterization of how someone behaves in meetings or conversations

Do NOT extract:
- Analytical inferences without specific evidence claims ("he values transparency")
- Register/stylistic choices ("he'll wear the suit to get in the boardroom")
- Structural framing ("This is the most important sentence in this profile")
- Instructions to the reader ("Don't ask him to pick a side")

## How to classify each claim

For each claim, assign one verdict:

**SUPPORTED** — The claim traces to specific text in the research package or canonical biographical data. Provide the source quote.

**EXEMPLAR_LEAK** — The claim matches biographical content from an exemplar profile (Bahat, Newmark, or McGlinchey) AND does not independently appear in the research package or canonical biographical data for this person. This includes:
- Specific facts from an exemplar (numbers, events, named organizations) projected onto the target
- Behavioral patterns described in an exemplar that were projected onto the target without independent evidence
- Phrases or framings distinctive to an exemplar that were transferred to the target

IMPORTANT — AVOIDING FALSE POSITIVES:

Before classifying ANY claim as EXEMPLAR_LEAK, you MUST check whether the specific fact appears in the research package OR the LinkedIn JSON for this target.

Examples of what is NOT contamination:
- A dollar figure that appears in both an exemplar AND in this target's career history (e.g. "$6M gift from Craig Newmark Philanthropies" — this is in the target's LinkedIn description of their time at Consumer Reports, even though "Newmark" is also an exemplar name)
- An organizational fact about a company where both the target and an exemplar worked, if the target's involvement is documented in the research package
- A behavioral pattern that appears in an exemplar AND is independently supported by evidence in the research package for this target

A claim is EXEMPLAR_LEAK only if:
1. The behavioral pattern, biographical detail, or specific language appears in an exemplar profile, AND
2. It does NOT appear in the research package or LinkedIn data for this target, AND
3. The claim cannot be independently verified from the target's own sources

When in doubt, classify as UNSUPPORTED rather than EXEMPLAR_LEAK.

**FABRICATED** — The claim contains a specific number, quote, or event that appears in neither the research package, the canonical biographical data, nor the exemplars. The model invented it.

**UNSUPPORTED** — The claim is plausible and could be a reasonable inference, but no specific source text confirms it. It may be true but the evidence doesn't establish it.

## Severity

- EXEMPLAR_LEAK → always CRITICAL
- FABRICATED → always CRITICAL
- UNSUPPORTED with specific numbers or quotes → HIGH
- UNSUPPORTED analytical inference → LOW

## Output format

Return ONLY valid JSON. No markdown, no preamble, no explanation outside the JSON.

{
  "target_name": "string",
  "total_claims_checked": number,
  "supported": number,
  "unsupported": number,
  "exemplar_leak": number,
  "fabricated": number,
  "critical_count": number,
  "pass": boolean,
  "items": [
    {
      "claim": "exact text from the draft containing the claim",
      "section": "which profile section (e.g. '1. THE OPERATING SYSTEM')",
      "verdict": "SUPPORTED | UNSUPPORTED | EXEMPLAR_LEAK | FABRICATED",
      "severity": "CRITICAL | HIGH | LOW",
      "evidence": "if SUPPORTED: quote from research package. if EXEMPLAR_LEAK: quote from the exemplar it matches plus confirmation it's absent from research package. if FABRICATED: note that no source contains this. if UNSUPPORTED: note what's missing.",
      "exemplar_source": "Bahat | Newmark | McGlinchey | null",
      "fix": "suggested replacement text using only research package evidence, or 'REMOVE' if no replacement possible"
    }
  ]
}

The "pass" field is false if critical_count > 0.

## Verification rules

1. Dollar amounts: verify the exact figure appears in a source. "$100 million" requires a source saying "$100 million" or numbers that sum to it. Round-number claims without sources are FABRICATED.

2. Counts and durations: "102 job interviews", "three decades", "four years restoring" — each needs a source. Approximate durations derivable from LinkedIn dates (e.g. "five years at Mozilla" from 2010-2015) count as SUPPORTED via canonical biographical data.

3. Direct quotes in quotation marks: must appear verbatim in the research package. If a quote appears in an exemplar but not the research package, it is EXEMPLAR_LEAK regardless of how well it fits.

4. Behavioral observations: "He's a chronic interrupter" or "he signals informality as a test" — check whether the research package describes this behavior. If the exemplar describes it for a different donor and the research package doesn't independently establish it for this target, it is EXEMPLAR_LEAK.

5. LinkedIn claims: "Lists unemployment periods on LinkedIn" — verify against the canonical biographical data JSON. If the LinkedIn JSON doesn't show this, check if the research package mentions it. If neither does but an exemplar profile describes this behavior, EXEMPLAR_LEAK.

6. Named connections: "Ford Foundation connections", "Bloomberg Beta network" — verify these organizations appear in the target's research package or LinkedIn, not just in an exemplar's profile.

Be thorough. Check every specific claim. Err on the side of flagging rather than passing. A false positive (flagging something that turns out to be fine) is far less costly than a false negative (passing exemplar contamination into the final profile).`,
      factCheckUserMessage,
      { maxTokens: 16000, model: 'claude-sonnet-4-5-20250929' },
    );

    // Parse JSON response
    const cleaned = factCheckResponse.replace(/```json\n?|```\n?/g, '').trim();
    factCheckResult = JSON.parse(cleaned);

    // Console logging
    console.log(`[Fact-Check] Complete: ${factCheckResult.total_claims_checked} claims checked, ${factCheckResult.supported} supported, ${factCheckResult.unsupported} unsupported, ${factCheckResult.exemplar_leak} exemplar_leak, ${factCheckResult.fabricated} fabricated`);

    // Log each CRITICAL item individually
    const criticalItems = (factCheckResult.items || []).filter((i: any) => i.severity === 'CRITICAL');
    for (const item of criticalItems) {
      const source = item.exemplar_source ? ` (${item.exemplar_source})` : '';
      console.log(`[Fact-Check] CRITICAL: "${item.claim.slice(0, 80)}${item.claim.length > 80 ? '...' : ''}" → ${item.verdict}${source}`);
    }

    // Progress event
    if (factCheckResult.pass) {
      emit(`✓ Fact-check passed: ${factCheckResult.supported}/${factCheckResult.total_claims_checked} claims verified`, 'analysis', 25, TOTAL_STEPS);
    } else {
      emit(`⚠ Fact-check found ${factCheckResult.critical_count} critical issues — fixing in editorial pass`, 'analysis', 25, TOTAL_STEPS);
      console.log(`[Fact-Check] Passing ${criticalItems.length} critical items to editorial pass`);

      // Build the mandatory-fix block for the editorial prompt
      factCheckBlock = `

══════════════════════════════════════════
MANDATORY CORRECTIONS FROM FACT-CHECK
══════════════════════════════════════════

An independent fact-checker has audited every specific claim in the first draft. The following items MUST be corrected. This is not optional. Do not preserve any flagged claim in any form — not rephrased, not softened, not restructured.

RULES:
- EXEMPLAR_LEAK: DELETE the claim entirely. This content came from a reference profile about a different person, not from evidence about this target. Do not keep the behavioral pattern in different words. Remove it completely.
- FABRICATED: DELETE the claim entirely. No evidence supports it.
- UNSUPPORTED: Either find explicit support in the research package (cite the source URL), or delete the claim.

Your editorial output will be audited against this list. Every CRITICAL item that survives in any form — including rephrased versions of the same claim — is a failure.

After deletions, if a section becomes thin, fill ONLY with evidence from the research package. Never invent replacement content.

After completing all corrections, re-read the full profile once more to check for any surviving instances of the deleted claims that may appear in other sections (claims often repeat across sections).

CRITICAL ITEMS:
${JSON.stringify(criticalItems, null, 2)}
`;
    }

    // Debug save
    try {
      writeFileSync('/tmp/prospectai-outputs/DEBUG-fact-check.json', JSON.stringify(factCheckResult, null, 2));
      console.log('[DEBUG] Wrote /tmp/prospectai-outputs/DEBUG-fact-check.json');
    } catch (e) { /* ignore */ }

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Fact-Check] Failed (pipeline continues without it): ${errMsg}`);
    emit('Fact-check skipped — continuing to editorial pass', 'analysis', 25, TOTAL_STEPS);
  }

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
    factCheckBlock,
  );
  console.log(`[Editorial] Prompt size: ${estimateTokens(critiquePrompt)} tokens`);

  try {
    writeFileSync('/tmp/prospectai-outputs/DEBUG-critique-prompt.txt', critiquePrompt);
  } catch (e) { /* ignore */ }

  if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
  const critiqueMessages: Message[] = [{ role: 'user', content: critiquePrompt }];
  const finalProfile = await conversationTurn(critiqueMessages, {
    maxTokens: 16000,
    abortSignal,
    model: 'claude-opus-4-20250514',
    systemPrompt: 'You are an editorial critic reviewing a donor persuasion profile against exacting production standards. Your job is to find where the draft fails — weak analysis, register violations, restatement, unsupported claims — and produce a stronger redraft.',
  });

  const reduction = Math.round((1 - finalProfile.length / firstDraftProfile.length) * 100);
  console.log(`[Editorial] ${firstDraftProfile.length} → ${finalProfile.length} chars (${reduction}% reduction)`);
  emit(`Editorial pass complete — ${reduction}% tighter`, 'analysis', 31, TOTAL_STEPS);

  try {
    writeFileSync('/tmp/prospectai-outputs/DEBUG-profile-final.txt', finalProfile);
  } catch (e) { /* ignore */ }

  // ── Step 4: Meeting Guide Generation (Opus) ─────────────────────
  emit('', 'writing');
  emit('Writing tactical meeting guide', 'writing', 33, TOTAL_STEPS);
  console.log('[Pipeline] Step 4: Meeting guide (Sonnet)');

  const meetingGuideBlock = loadMeetingGuideBlockV3();
  const meetingGuideExemplars = loadMeetingGuideExemplars(donorName);
  const meetingGuideOutputTemplate = loadMeetingGuideOutputTemplate();
  const dtwOrgLayer = loadDTWOrgLayer();

  const meetingGuidePrompt = buildMeetingGuidePrompt(
    donorName,
    finalProfile,
    meetingGuideBlock,
    dtwOrgLayer,
    meetingGuideExemplars,
    meetingGuideOutputTemplate,
  );

  try {
    writeFileSync('/tmp/prospectai-outputs/DEBUG-meeting-guide-prompt.txt', meetingGuidePrompt);
  } catch (e) { /* ignore */ }

  if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
  const meetingGuideMessages: Message[] = [{ role: 'user', content: meetingGuidePrompt }];
  const meetingGuide = await conversationTurn(meetingGuideMessages, {
    maxTokens: 8000,
    abortSignal,
    systemPrompt: MEETING_GUIDE_SYSTEM_PROMPT,
  });
  console.log(`[Meeting Guide] ${meetingGuide.length} chars`);

  const meetingGuideHtml = formatMeetingGuideEmbeddable(meetingGuide);
  const meetingGuideHtmlFull = formatMeetingGuide(meetingGuide);

  try {
    writeFileSync('/tmp/prospectai-outputs/DEBUG-meeting-guide.md', meetingGuide);
  } catch (e) { /* ignore */ }

  try {
    writeFileSync('/tmp/prospectai-outputs/DEBUG-meeting-guide.html', meetingGuideHtmlFull);
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
