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
import { selectExemplars, loadExemplars, loadGeoffreyBlock, loadMeetingGuideBlockV3, loadMeetingGuideExemplars, loadMeetingGuideOutputTemplate, loadDTWOrgLayer } from './canon/loader';
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

// Deep research (OpenAI o3-deep-research) — alternative to Tavily pipeline
import { runDeepResearchV5, DeepResearchResult, validateResearchPackage } from './research/deep-research';
import type { ActivityCallback } from './job-store';

// v5 pipeline modules
import { deduplicateSources } from './research/dedup';
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
    // v5 HYBRID PIPELINE: Stages 1→2→3→4→5→6
    //
    // Stage 1: Query Generation (Sonnet)
    // Stage 2: Search Execution (Tavily)
    // Stage 3: Screening & Attribution (Sonnet)
    // Stage 4: Content Fetch + Dedup (Tavily Extract)
    // Stage 5: Dimension Scoring & Selection (Sonnet)
    // Stage 6: Research Synthesis (o3-deep-research)
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

    // ── Stage 5: Dimension Scoring & Selection ───────────────────
    if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
    emit(`Scoring ${dedupedSources.length} sources against 25 dimensions`, 'research', 14, TOTAL_STEPS);
    console.log('[Stage 5] Dimension scoring & selection');

    const stage5Result = await runDimensionScoring(dedupedSources, donorName, identity, linkedinData);
    const selectedSources = stage5Result.selectedSources;
    const coverageGapReport = formatCoverageGapReport(stage5Result.coverageGaps);
    const sourcesFormatted = formatSourcesForDeepResearch(selectedSources);

    console.log(`[Stage 5] Selected ${selectedSources.length} sources (~${stage5Result.stats.estimatedContentChars} chars)`);
    emit(`${selectedSources.length} sources selected for synthesis (~${Math.round(stage5Result.stats.estimatedContentChars / 1000)}K chars)`, 'research', 15, TOTAL_STEPS);

    // ── Stage 6: Research Synthesis (Deep Research) ──────────────
    if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');
    emit('Launching bounded synthesis with pre-fetched sources', 'research', 16, TOTAL_STEPS);
    console.log('[Stage 6] Running Deep Research (bounded synthesis)');

    deepResearchResult = await runDeepResearchV5(
      donorName,
      linkedinData,
      selectedSources,
      sourcesFormatted,
      coverageGapReport,
      emit,
      abortSignal,
      onActivity,
    );

    // The dossier IS the research package for profile generation
    researchPackage = deepResearchResult.dossier;

    // Validate research package quality
    const validationChecks = validateResearchPackage(researchPackage, selectedSources.length);
    console.log(`[Stage 6] Validation: length=${validationChecks.length}, sources cited=${validationChecks.uniqueSourcesCited}/${validationChecks.sourcesExpected}, patterns=${validationChecks.totalPatternFlags}`);

    // Create ResearchResult for compatibility
    research = {
      donorName,
      identity,
      queries: categorizedQueries.map(q => ({
        query: q.query,
        tier: q.category === 'A' ? 'STANDARD' as const : 'TAILORED' as const,
        rationale: `[Cat ${q.category}] ${q.rationale}`,
      })),
      sources: deepResearchResult.citations.map(c => ({
        url: c.url,
        title: c.title,
        snippet: '',
      })),
      rawMarkdown: `# v5 RESEARCH DOSSIER: ${donorName}\n\nPipeline: v5 hybrid (Tavily breadth + bounded synthesis)\nQueries: ${categorizedQueries.length}\nScreened: ${screenedSources.length}/${allSources.length}\nSelected: ${selectedSources.length}\nGap-fill searches: ${deepResearchResult.searchCount}\nCitations: ${deepResearchResult.citations.length}\nDuration: ${(deepResearchResult.durationMs / 60000).toFixed(1)} minutes\n\n${researchPackage}`,
    };

    console.log(`\n[Pipeline] v5 research complete: ${deepResearchResult.searchCount} gap-fill searches, ${researchPackage.length} chars\n`);
    STATUS.researchComplete(deepResearchResult.searchCount);
    emit(`Research synthesis ready — ${Math.round(researchPackage.length / 4)} tokens`, 'analysis', 20, TOTAL_STEPS);
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
    ? `The behavioral evidence below is a deep research dossier compiled from ${deepResearchResult.searchCount} web searches with ${deepResearchResult.citations.length} cited sources. Each behavioral dimension contains two blocks:

QUOTES — the subject's own words and direct evidence from sources. These are your primary evidence. Build your behavioral claims from what the subject actually said and did, not from the research analyst's interpretation of what they said and did.

ANALYSIS — one research analyst's interpretive commentary on the quotes. This commentary is a first read — useful as a starting hypothesis, but not authoritative. It was written by a model optimized for research synthesis, not for the operational briefing register this profile requires. When the commentary and a quote point in different directions, follow the quote. When the commentary describes a personality trait or uses academic language ("suggests a pattern of," "indicates a relationship style"), look past it to the quote underneath for the behavioral pattern you can actually deploy in a meeting.

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
