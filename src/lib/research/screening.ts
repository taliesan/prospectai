// Aggressive Pre-Extraction Screening
// Automatic rejection rules, LLM screening for behavioral evidence, deduplication by coverage event

import { complete } from '../anthropic';

// Source type used across the research pipeline
export interface ResearchSource {
  url: string;
  title: string;
  snippet: string;
  content?: string;
  query?: string;
  queryCategory?: 'A' | 'B' | 'C' | 'D' | 'E';
  queryHypothesis?: string;
  source?: string; // provenance tag: 'blog_crawl', 'linkedin_post', 'tavily', etc.
  bypassScreening?: boolean; // skip screening for blog crawl / linkedin posts
}

export interface ScreeningResult {
  accepted: boolean;
  rejectionReason?: string;
  needsLLMScreen: boolean;
}

export interface ScreeningStats {
  autoRejected: number;
  autoAccepted: number;
  llmScreened: number;
  llmAccepted: number;
  llmRejected: number;
  beforeDedup: number;
  afterDedup: number;
  final: number;
}

// ── Name variant generation ─────────────────────────────────────────

function getNameVariants(subjectName: string): string[] {
  const variants: string[] = [subjectName];
  const parts = subjectName.trim().split(/\s+/);

  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];

    // "John Smith" → "J. Smith", "Smith, John"
    variants.push(`${first[0]}. ${last}`);
    variants.push(`${last}, ${first}`);

    // Handle middle names: "John Michael Smith" → "John Smith", "J.M. Smith"
    if (parts.length >= 3) {
      variants.push(`${first} ${last}`);
      const middleInitials = parts.slice(1, -1).map(p => `${p[0]}.`).join('');
      variants.push(`${first[0]}.${middleInitials} ${last}`);
    }
  }

  return variants;
}

// ── Boilerplate removal ─────────────────────────────────────────────

function removeBoilerplate(content: string): string {
  // Strip common boilerplate patterns
  let cleaned = content;

  // Remove cookie banners, privacy notices
  cleaned = cleaned.replace(/(?:we use cookies|cookie policy|privacy policy|accept all cookies|manage preferences)[\s\S]{0,500}/gi, '');

  // Remove navigation/menu patterns
  cleaned = cleaned.replace(/(?:home|about|contact|login|sign up|subscribe|newsletter)\s*[\|\/]\s*/gi, '');

  // Remove footer-like content
  cleaned = cleaned.replace(/(?:copyright|©|all rights reserved|terms of service|privacy policy)[\s\S]*/gi, '');

  // Remove social share blocks
  cleaned = cleaned.replace(/(?:share on|follow us|tweet this|facebook|linkedin|twitter)\s*[\|\/\s]*/gi, '');

  return cleaned.trim();
}

// ── Name context extraction ─────────────────────────────────────────

function extractNameContext(content: string, subjectName: string, windowSize: number): string[] {
  const contexts: string[] = [];
  const lowerContent = content.toLowerCase();
  const lowerName = subjectName.toLowerCase();

  let startIdx = 0;
  while (true) {
    const idx = lowerContent.indexOf(lowerName, startIdx);
    if (idx === -1) break;

    const contextStart = Math.max(0, idx - windowSize);
    const contextEnd = Math.min(content.length, idx + lowerName.length + windowSize);
    contexts.push(content.slice(contextStart, contextEnd));

    startIdx = idx + 1;
  }

  return contexts;
}

// ── Junk URL patterns ───────────────────────────────────────────────

const JUNK_URL_PATTERNS = [
  /whitepages\.com/i,
  /spokeo\.com/i,
  /beenverified\.com/i,
  /fastpeoplesearch/i,
  /zoominfo\.com\/p\//i,
  /linkedin\.com\/pub\/dir/i,
  /signalhire\.com/i,
  /rocketreach\.co/i,
  /contactout\.com/i,
  /lusha\.com/i,
  /apollo\.io\/contacts/i,
  /peoplefinders\.com/i,
  /intelius\.com/i,
  /truepeoplesearch\.com/i,
  /thatsthem\.com/i,
  /radaris\.com/i,
  /pipl\.com/i,
  /instantcheckmate\.com/i,
];

// ── Step 1: Automatic screening (no LLM call) ──────────────────────

export function automaticScreen(
  source: ResearchSource,
  subjectName: string,
  isOrgContextQuery: boolean
): ScreeningResult {
  const content = source.content || source.snippet || '';
  const url = source.url || '';

  // Sources from blog crawl or LinkedIn posts bypass screening
  if (source.bypassScreening) {
    return { accepted: true, needsLLMScreen: false };
  }

  // 1. Name check (skip for Category D org-context queries)
  if (!isOrgContextQuery) {
    const nameVariants = getNameVariants(subjectName);
    // Include snippet + content + title — bulk-fetched content may not contain the name
    // even though the original Tavily search snippet does
    const searchText = `${source.content || ''} ${source.snippet || ''} ${source.title || ''}`.toLowerCase();
    const hasName = nameVariants.some(v => searchText.includes(v.toLowerCase()));
    if (!hasName) {
      return { accepted: false, rejectionReason: 'Subject name not found in content', needsLLMScreen: false };
    }
  }

  // 2. Directory/people-search pages
  if (JUNK_URL_PATTERNS.some(p => p.test(url))) {
    return { accepted: false, rejectionReason: 'Directory/people-search page', needsLLMScreen: false };
  }

  // 3. Content too short after boilerplate removal
  const cleanedContent = removeBoilerplate(content);
  if (cleanedContent.length < 100) {
    return { accepted: false, rejectionReason: 'Content too short after boilerplate removal', needsLLMScreen: false };
  }

  // 4. Large PDF with only marginal mentions
  if (url.endsWith('.pdf') && content.length > 50000) {
    const nameContext = extractNameContext(content, subjectName, 200);
    if (nameContext.length > 0) {
      const isMarginalMention = nameContext.every(ctx =>
        /footnote|bibliography|references|participant|attendee|contributor list|acknowledgment/i.test(ctx)
      );
      if (isMarginalMention) {
        return { accepted: false, rejectionReason: 'PDF mentions subject only in footnotes/bibliography', needsLLMScreen: false };
      }
    }
  }

  // Passed automatic filters — may need LLM screening
  return { accepted: true, needsLLMScreen: true };
}

// ── Step 2: LLM screening for behavioral evidence ──────────────────

const LLM_SCREENING_PROMPT = `You are screening a source for behavioral evidence about {subjectName}.

Does this source contain ANY of the following?
A) A direct quote from {subjectName} (their actual words in quotation marks)
B) A substantive description of their actions, decisions, or behavior (not just their job title)
C) Biographical information not available from a standard LinkedIn profile

Source URL: {url}
Source content (excerpt):
{content}

Respond with ONLY one of:
- ACCEPT: [brief reason — which criterion A/B/C it meets]
- REJECT: [brief reason — why it lacks behavioral evidence]`;

export async function llmScreenSources(
  sources: ResearchSource[],
  subjectName: string
): Promise<{ accepted: ResearchSource[]; rejected: ResearchSource[] }> {
  if (sources.length === 0) {
    return { accepted: [], rejected: [] };
  }

  const BATCH_SIZE = 20;
  const accepted: ResearchSource[] = [];
  const rejected: ResearchSource[] = [];

  for (let i = 0; i < sources.length; i += BATCH_SIZE) {
    const batch = sources.slice(i, i + BATCH_SIZE);

    const batchPrompt = `Screen these ${batch.length} sources for behavioral evidence about ${subjectName}.

For each source, does it contain ANY of:
A) A direct quote from ${subjectName} (their actual words)
B) A substantive description of their actions, decisions, or behavior (not just job title or bio)
C) Biographical information not available from a standard LinkedIn profile

Sources:
${batch.map((s, idx) => `
[${idx}] URL: ${s.url}
Title: ${s.title || 'Untitled'}
Excerpt: ${(s.content || s.snippet || '').slice(0, 800)}
`).join('\n---\n')}

For each source, respond with ONLY:
[index] ACCEPT: [brief reason — which criterion A/B/C] OR
[index] REJECT: [brief reason]

Output as JSON array:
[
  { "index": 0, "decision": "ACCEPT", "reason": "Contains direct quote about leadership philosophy" },
  { "index": 1, "decision": "REJECT", "reason": "Just a directory listing with job title" }
]`;

    try {
      const response = await complete(
        'You are screening sources for behavioral evidence quality.',
        batchPrompt,
        { maxTokens: 2048 }
      );

      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const results = JSON.parse(jsonMatch[0]);
        for (const r of results) {
          if (r.index >= 0 && r.index < batch.length) {
            if (r.decision === 'ACCEPT') {
              accepted.push(batch[r.index]);
            } else {
              rejected.push(batch[r.index]);
            }
          }
        }
        // Handle any sources not in the response (fail open)
        const handledIndices = new Set(results.map((r: any) => r.index));
        for (let j = 0; j < batch.length; j++) {
          if (!handledIndices.has(j)) {
            accepted.push(batch[j]);
          }
        }
      } else {
        // Parse failure — fail open
        accepted.push(...batch);
      }
    } catch (err) {
      console.error('[Screening] LLM screening batch failed:', err);
      // On error, accept all (fail open)
      accepted.push(...batch);
    }
  }

  return { accepted, rejected };
}

// ── Step 3: Deduplication by coverage event ─────────────────────────

interface SourceCluster {
  topic: string;
  sourceIndices: number[];
  bestIndex: number;
}

export async function deduplicateByCoverage(
  sources: ResearchSource[],
  subjectName: string
): Promise<ResearchSource[]> {
  // Skip dedup if few sources
  if (sources.length <= 15) {
    return sources;
  }

  const clusteringPrompt = `Given these ${sources.length} sources about ${subjectName}, group them by the event, role, or topic they cover. Sources covering the same news story, event, or topic should be in the same group.

For each group, identify which source has the most direct quotes or behavioral detail.

Sources:
${sources.map((s, i) => `[${i}] ${s.url}
Title: ${s.title || 'Untitled'}
Excerpt: ${(s.content || s.snippet || '').slice(0, 300)}...`).join('\n\n')}

Respond in JSON:
{
  "clusters": [
    { "topic": "description of shared event/topic", "sourceIndices": [0, 3, 5], "bestIndex": 3 }
  ],
  "unclustered": [1, 2, 4]
}

Rules:
- Only cluster sources that cover genuinely the SAME event/story/topic
- If a source is unique, put its index in "unclustered"
- For each cluster, bestIndex should be the source with most quotes or behavioral detail`;

  try {
    const response = await complete(
      'You are deduplicating research sources by coverage event.',
      clusteringPrompt,
      { maxTokens: 4096 }
    );

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return sources;

    const parsed = JSON.parse(jsonMatch[0]);
    const kept = new Set<number>();

    // Keep best from each cluster
    if (parsed.clusters && Array.isArray(parsed.clusters)) {
      for (const cluster of parsed.clusters) {
        if (typeof cluster.bestIndex === 'number' && cluster.bestIndex < sources.length) {
          kept.add(cluster.bestIndex);
        }
        // Also keep one backup from each large cluster
        if (cluster.sourceIndices?.length > 3) {
          const backup = cluster.sourceIndices.find((i: number) => i !== cluster.bestIndex);
          if (backup !== undefined) kept.add(backup);
        }
      }
    }

    // Keep all unclustered
    if (parsed.unclustered && Array.isArray(parsed.unclustered)) {
      for (const idx of parsed.unclustered) {
        if (typeof idx === 'number' && idx < sources.length) {
          kept.add(idx);
        }
      }
    }

    // If dedup removed too many, fall back to original list
    if (kept.size < 10 && sources.length > 10) {
      console.log('[Screening] Dedup was too aggressive, keeping original list');
      return sources;
    }

    return Array.from(kept).sort((a, b) => a - b).map(i => sources[i]);
  } catch (err) {
    console.error('[Screening] Dedup clustering failed:', err);
    return sources;
  }
}

// ── Full screening pipeline ─────────────────────────────────────────

export async function runScreeningPipeline(
  sources: ResearchSource[],
  subjectName: string,
  identity: any
): Promise<{ screened: ResearchSource[]; stats: ScreeningStats }> {
  console.log(`[Screening] Starting screening of ${sources.length} sources`);

  const stats: ScreeningStats = {
    autoRejected: 0,
    autoAccepted: 0,
    llmScreened: 0,
    llmAccepted: 0,
    llmRejected: 0,
    beforeDedup: 0,
    afterDedup: 0,
    final: 0,
  };

  // Step 1: Automatic screening
  const autoAccepted: ResearchSource[] = [];
  const needsLLM: ResearchSource[] = [];
  const autoRejected: ResearchSource[] = [];

  for (const source of sources) {
    const isOrgContext = source.queryCategory === 'D';
    const result = automaticScreen(source, subjectName, isOrgContext);

    if (!result.accepted) {
      autoRejected.push(source);
    } else if (result.needsLLMScreen) {
      needsLLM.push(source);
    } else {
      autoAccepted.push(source);
    }
  }

  stats.autoRejected = autoRejected.length;
  stats.autoAccepted = autoAccepted.length;

  console.log(`[Screening] Automatic rejection: ${autoRejected.length} sources`);
  console.log(`[Screening] Auto-accepted (bypassed): ${autoAccepted.length} sources`);
  console.log(`[Screening] Needs LLM screening: ${needsLLM.length} sources`);

  // Log rejection reasons
  const rejectionReasons = autoRejected.reduce((acc, s) => {
    const result = automaticScreen(s, subjectName, s.queryCategory === 'D');
    const reason = result.rejectionReason || 'unknown';
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  for (const [reason, count] of Object.entries(rejectionReasons)) {
    console.log(`[Screening]   - ${reason}: ${count}`);
  }

  // Step 2: LLM screening for marginal sources
  const llmResult = await llmScreenSources(needsLLM, subjectName);
  stats.llmScreened = needsLLM.length;
  stats.llmAccepted = llmResult.accepted.length;
  stats.llmRejected = llmResult.rejected.length;

  console.log(`[Screening] LLM screening: ${needsLLM.length} sources (${llmResult.accepted.length} accepted, ${llmResult.rejected.length} rejected)`);

  // Combine auto-accepted + LLM-accepted
  const allAccepted = [...autoAccepted, ...llmResult.accepted];
  stats.beforeDedup = allAccepted.length;

  // Step 3: Deduplication by coverage event
  const deduplicated = await deduplicateByCoverage(allAccepted, subjectName);
  stats.afterDedup = deduplicated.length;
  stats.final = deduplicated.length;

  console.log(`[Screening] Deduplication: ${allAccepted.length} → ${deduplicated.length} sources`);
  console.log(`[Screening] Final: ${deduplicated.length} sources passed screening`);

  return { screened: deduplicated, stats };
}
