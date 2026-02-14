// Stage 5 — Dimension Scoring, Selection & Gap Analysis (v5 Pipeline)
//
// Sonnet reads full fetched content from Stage 4 and:
//   1. Scores each source against 25 dimensions (0.0-1.0)
//   2. Classifies source tier (1-5)
//   3. Produces coverage gap report
//   4. Selects 15-25 sources within 100K content budget

import { complete } from '../anthropic';
import {
  DIMENSIONS,
  DimensionKey,
  DIMENSION_KEYS,
  dimKey,
  formatDimensionsForPrompt,
  SourceTier,
  SOURCE_TIER_LABELS,
  type AttributionType,
} from '../dimensions';
import type { ResearchSource } from '../research/screening';

// ── Stage 5 scoring prompt ──────────────────────────────────────────

function buildScoringPrompt(
  subjectName: string,
  sources: ResearchSource[],
  linkedinReference: string,
): string {
  const sourcesText = sources.map((s, i) => {
    const content = s.content || s.snippet || '';
    // Cap individual source content in the prompt at ~4K chars for scoring
    const truncated = content.length > 4000 ? content.slice(0, 4000) + '\n[... truncated for scoring ...]' : content;
    return `### Source ${i + 1}
URL: ${s.url}
Title: ${s.title || 'Untitled'}
Attribution: ${s.attribution || 'unknown'}
${s.institutionalContext ? `Institutional Context: ${s.institutionalContext}\n` : ''}
${truncated}`;
  }).join('\n\n---\n\n');

  return `You are a research analyst selecting sources for a behavioral profiling system. You will receive pre-screened sources with their full fetched content and attribution classifications. Your job is to score, rank, and select the best sources for downstream analysis.

SUBJECT: ${subjectName}
LINKEDIN REFERENCE: ${linkedinReference}

## Sources to Score
${sourcesText}

## Dimension Scoring

You are scoring based on FULL PAGE CONTENT, not snippets. Read each source and assess what behavioral evidence it actually contains. Score based on what you can see, not what you hope might be there.

For each source, score against the 25 dimensions using 0.0-1.0 scale. Score > 0.0 only if the content provides concrete behavioral evidence:
- A direct quote = score for COMMUNICATION_STYLE
- Mention of a decision or choice = score for DECISION_MAKING
- Conflict or controversy = score for CONTRADICTION_PATTERNS, BOUNDARY_CONDITIONS
- Interview/podcast format = score for REAL_TIME_INTERPERSONAL_TELLS
- Failure/setback mentioned = score for RECOVERY_PATHS, HIDDEN_FRAGILITIES
- Org restructuring, institutional strategy, coalition-building, or discussion of how decisions really get made = score for POWER_ANALYSIS

## BEHAVIORAL DIMENSIONS

${formatDimensionsForPrompt()}

## Source Tier Classification
Assign each URL a source tier:
- Tier 1: Podcast/interview/video — unscripted voice
- Tier 2: Press profile, journalist coverage, third-party analysis
- Tier 3: Self-authored (op-eds, LinkedIn posts, blog)
- Tier 4: Institutional evidence during tenure (inferential)
- Tier 5: Structural records (990s, filings, lobbying registries)

## Output Format

Return JSON:
{
  "scored_sources": [
    {
      "index": 1,
      "url": "https://...",
      "source_tier": 2,
      "dimension_scores": {
        "1_DECISION_MAKING": 0.7,
        "4_COMMUNICATION_STYLE": 0.9,
        "8_VALUES_HIERARCHY": 0.8
      }
    }
  ]
}

IMPORTANT: Only include dimensions with score > 0.0 in dimension_scores. Omit zero-scoring dimensions. Score ALL ${sources.length} sources.`;
}

// ── Scoring result types ────────────────────────────────────────────

export interface ScoredSource {
  index: number;
  url: string;
  title: string;
  attribution?: AttributionType;
  institutionalContext?: string;
  sourceTier: SourceTier;
  dimensionScores: Record<string, number>;
  content?: string;
  contentLength: number;
}

export interface CoverageGap {
  dimension: string;
  dimId: number;
  count: number;
  target: string;
  status: 'SUFFICIENT' | 'MARGINAL' | 'GAP' | 'CRITICAL_GAP' | 'ZERO_COVERAGE';
}

export interface Stage5Result {
  selectedSources: ScoredSource[];
  notSelected: Array<{ url: string; reason: string }>;
  coverageGaps: CoverageGap[];
  stats: {
    totalScored: number;
    selected: number;
    estimatedContentChars: number;
  };
}

// ── Run Stage 5 ─────────────────────────────────────────────────────

export async function runDimensionScoring(
  sources: ResearchSource[],
  subjectName: string,
  identity: any,
  linkedinData?: any,
): Promise<Stage5Result> {
  console.log(`[Stage 5] Scoring ${sources.length} sources against 25 dimensions`);

  // Build LinkedIn reference
  const linkedinRef = linkedinData
    ? `${linkedinData.currentTitle} at ${linkedinData.currentEmployer}; ${(linkedinData.careerHistory || []).slice(0, 4).map((j: any) => `${j.title} at ${j.employer} (${j.startDate}-${j.endDate})`).join('; ')}`
    : `${identity.currentRole || 'Unknown'} at ${identity.currentOrg || 'Unknown'}`;

  // Score in batches (Sonnet can handle ~20-25 sources per call with truncated content)
  const BATCH_SIZE = 20;
  const allScored: ScoredSource[] = [];

  for (let i = 0; i < sources.length; i += BATCH_SIZE) {
    const batch = sources.slice(i, i + BATCH_SIZE);
    const batchOffset = i;

    try {
      const prompt = buildScoringPrompt(subjectName, batch, linkedinRef);
      const response = await complete(
        'You are scoring research sources for behavioral evidence. Return JSON only.',
        prompt,
        { maxTokens: 8192 },
      );

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const scoredSources = parsed.scored_sources || [];

        for (const scored of scoredSources) {
          const idx = (scored.index || 1) - 1; // 1-based to 0-based
          if (idx < 0 || idx >= batch.length) continue;

          const source = batch[idx];
          allScored.push({
            index: batchOffset + idx,
            url: source.url,
            title: source.title,
            attribution: source.attribution,
            institutionalContext: source.institutionalContext,
            sourceTier: (scored.source_tier || 3) as SourceTier,
            dimensionScores: scored.dimension_scores || {},
            content: source.content,
            contentLength: (source.content || source.snippet || '').length,
          });
        }

        // Handle sources not in response (default score)
        const handledIndices = new Set(scoredSources.map((s: any) => (s.index || 1) - 1));
        for (let j = 0; j < batch.length; j++) {
          if (!handledIndices.has(j)) {
            allScored.push({
              index: batchOffset + j,
              url: batch[j].url,
              title: batch[j].title,
              attribution: batch[j].attribution,
              institutionalContext: batch[j].institutionalContext,
              sourceTier: 3,
              dimensionScores: {},
              content: batch[j].content,
              contentLength: (batch[j].content || batch[j].snippet || '').length,
            });
          }
        }
      } else {
        // Parse failure — assign defaults
        for (let j = 0; j < batch.length; j++) {
          allScored.push({
            index: batchOffset + j,
            url: batch[j].url,
            title: batch[j].title,
            attribution: batch[j].attribution,
            sourceTier: 3,
            dimensionScores: {},
            content: batch[j].content,
            contentLength: (batch[j].content || batch[j].snippet || '').length,
          });
        }
      }
    } catch (err) {
      console.error(`[Stage 5] Scoring batch failed:`, err);
      for (let j = 0; j < batch.length; j++) {
        allScored.push({
          index: batchOffset + j,
          url: batch[j].url,
          title: batch[j].title,
          attribution: batch[j].attribution,
          sourceTier: 3,
          dimensionScores: {},
          content: batch[j].content,
          contentLength: (batch[j].content || batch[j].snippet || '').length,
        });
      }
    }
  }

  console.log(`[Stage 5] Scored ${allScored.length} sources`);

  // ── Coverage gap analysis ──────────────────────────────────────────

  const coverageGaps = computeCoverageGaps(allScored);

  // Log gap summary
  for (const gap of coverageGaps) {
    if (gap.status !== 'SUFFICIENT') {
      console.log(`[Stage 5] ${gap.status}: ${gap.dimension} (${gap.count} sources, target: ${gap.target})`);
    }
  }

  // ── Selection ──────────────────────────────────────────────────────

  const { selected, notSelected } = selectSources(allScored, coverageGaps);

  const estimatedContentChars = selected.reduce((sum, s) => sum + s.contentLength, 0);

  console.log(`[Stage 5] Selected ${selected.length}/${allScored.length} sources (~${estimatedContentChars} chars)`);

  return {
    selectedSources: selected,
    notSelected,
    coverageGaps,
    stats: {
      totalScored: allScored.length,
      selected: selected.length,
      estimatedContentChars,
    },
  };
}

// ── Coverage gap computation ────────────────────────────────────────

function computeCoverageGaps(scored: ScoredSource[]): CoverageGap[] {
  const gaps: CoverageGap[] = [];

  for (const dim of DIMENSIONS) {
    const key = dimKey(dim);
    const count = scored.filter(s => (s.dimensionScores[key] || 0) > 0.3).length;

    let status: CoverageGap['status'];
    if (count >= dim.targetMin) {
      status = 'SUFFICIENT';
    } else if (count === 0) {
      status = 'ZERO_COVERAGE';
    } else if (count >= dim.targetMin - 1) {
      status = 'MARGINAL';
    } else if (dim.tier === 'HIGH' && count < dim.targetMin / 2) {
      status = 'CRITICAL_GAP';
    } else {
      status = 'GAP';
    }

    gaps.push({
      dimension: key,
      dimId: dim.id,
      count,
      target: `${dim.targetMin}-${dim.targetMax}`,
      status,
    });
  }

  return gaps;
}

// ── Source selection logic ───────────────────────────────────────────

const CONTENT_BUDGET_CHARS = 100_000;
const MAX_SOURCES = 25;
const MIN_SOURCES = 15;

function selectSources(
  scored: ScoredSource[],
  gaps: CoverageGap[],
): { selected: ScoredSource[]; notSelected: Array<{ url: string; reason: string }> } {
  // Priority scoring for each source
  const prioritized = scored.map(s => ({
    source: s,
    priority: computeSelectionPriority(s, gaps),
  }));

  // Sort by priority descending
  prioritized.sort((a, b) => b.priority - a.priority);

  const selected: ScoredSource[] = [];
  const notSelected: Array<{ url: string; reason: string }> = [];
  let totalChars = 0;

  for (const { source, priority } of prioritized) {
    if (selected.length >= MAX_SOURCES) {
      notSelected.push({ url: source.url, reason: 'Max source count reached' });
      continue;
    }

    if (totalChars + source.contentLength > CONTENT_BUDGET_CHARS && selected.length >= MIN_SOURCES) {
      notSelected.push({ url: source.url, reason: 'Content budget exceeded' });
      continue;
    }

    selected.push(source);
    totalChars += source.contentLength;
  }

  return { selected, notSelected };
}

function computeSelectionPriority(source: ScoredSource, gaps: CoverageGap[]): number {
  let priority = 0;

  // Priority 1: Source covers a critical gap or zero-coverage dimension
  const criticalGaps = new Set(
    gaps.filter(g => g.status === 'CRITICAL_GAP' || g.status === 'ZERO_COVERAGE').map(g => g.dimension)
  );
  for (const [dim, score] of Object.entries(source.dimensionScores)) {
    if (score > 0.3 && criticalGaps.has(dim)) {
      priority += 50;
    }
  }

  // Priority 2: Tier 1 sources (podcasts/interviews) — always valuable
  if (source.sourceTier === 1) priority += 30;

  // Priority 3: Covers multiple High-tier dimensions
  const highTierDims = new Set(
    DIMENSIONS.filter(d => d.tier === 'HIGH').map(d => dimKey(d))
  );
  let highDimCount = 0;
  for (const [dim, score] of Object.entries(source.dimensionScores)) {
    if (score > 0.3 && highTierDims.has(dim)) {
      highDimCount++;
    }
  }
  priority += highDimCount * 10;

  // Priority 4: Only source for a given dimension (uniqueness bonus)
  // (This is approximated — full uniqueness check would require knowing all sources)
  const gapDims = new Set(gaps.filter(g => g.status === 'GAP' || g.status === 'MARGINAL').map(g => g.dimension));
  for (const [dim, score] of Object.entries(source.dimensionScores)) {
    if (score > 0.3 && gapDims.has(dim)) {
      priority += 15;
    }
  }

  // Priority 5: Source tier bonus (Tier 2-3 > Tier 4-5)
  if (source.sourceTier <= 3) priority += 5;

  // Priority 6: Total dimension coverage breadth
  const coveredDims = Object.values(source.dimensionScores).filter(s => s > 0.3).length;
  priority += coveredDims * 3;

  return priority;
}

// ── Format coverage gap report for Stage 6 ──────────────────────────

export function formatCoverageGapReport(gaps: CoverageGap[]): string {
  const lines: string[] = [];
  lines.push('COVERAGE GAP ANALYSIS FROM PRE-RESEARCH:');
  lines.push('The following dimensions have weak or zero coverage in the pre-loaded');
  lines.push('sources. After you have fully processed all pre-fetched sources,');
  lines.push('conduct a LIMITED round of web searches (no more than 15-20 searches)');
  lines.push('targeting these specific gaps:\n');

  const gapDims = gaps.filter(g => g.status !== 'SUFFICIENT');
  if (gapDims.length === 0) {
    lines.push('All dimensions have sufficient coverage. Gap-fill search is optional.');
    return lines.join('\n');
  }

  // Sort: critical gaps first, then gaps, then marginal, then zero coverage
  const statusOrder: Record<string, number> = {
    'CRITICAL_GAP': 0,
    'ZERO_COVERAGE': 1,
    'GAP': 2,
    'MARGINAL': 3,
  };
  gapDims.sort((a, b) => (statusOrder[a.status] || 4) - (statusOrder[b.status] || 4));

  for (const gap of gapDims) {
    lines.push(`${gap.dimId.toString().padStart(2)}. ${gap.dimension.split('_').slice(1).join('_') || gap.dimension} — ${gap.status} (${gap.count} sources, need ${gap.target})`);
  }

  lines.push('\nSuggested gap-fill searches: interviews where subject is challenged,');
  lines.push('moments of public failure/criticism, colleague testimonials about');
  lines.push('working style under pressure, crisis responses, organizational');
  lines.push('departures or transitions, restructuring decisions, coalition-building,');
  lines.push('or descriptions of how internal decisions actually get made.');

  return lines.join('\n');
}

// ── Format selected sources for Stage 6 input ───────────────────────

export function formatSourcesForDeepResearch(
  selected: ScoredSource[],
): string {
  const lines: string[] = [];
  lines.push(`PRE-FETCHED SOURCE MATERIAL:`);
  lines.push(`The following ${selected.length} sources have been selected from candidates,`);
  lines.push(`scored on 25 behavioral dimensions, and verified as relevant.`);
  lines.push(`You are REQUIRED to read each one in full and extract all behavioral`);
  lines.push(`evidence before conducting any web searches.\n`);

  for (let i = 0; i < selected.length; i++) {
    const s = selected[i];
    const content = s.content || '';
    const dimCoverage = Object.entries(s.dimensionScores)
      .filter(([, score]) => score > 0.3)
      .map(([dim]) => dim)
      .join(', ');

    lines.push(`=== SOURCE ${i + 1} of ${selected.length} ===`);
    lines.push(`URL: ${s.url}`);
    lines.push(`Title: ${s.title}`);
    lines.push(`Source Tier: ${s.sourceTier} (${SOURCE_TIER_LABELS[s.sourceTier]})`);
    lines.push(`Attribution: ${s.attribution || 'unknown'}`);
    if (s.institutionalContext) {
      lines.push(`Institutional Context: ${s.institutionalContext}`);
    }
    lines.push(`Dimension Coverage (predicted): ${dimCoverage || 'none scored'}`);
    lines.push('');
    lines.push(content);
    lines.push('===\n');
  }

  return lines.join('\n');
}

// ── Backward compatibility exports ──────────────────────────────────

export const SOURCE_SCORING_PROMPT = 'DEPRECATED: Use runDimensionScoring() instead';

export function buildScoringPromptCompat(
  donorName: string,
  sources: { url: string; title: string; snippet: string; content?: string }[],
): string {
  return buildScoringPrompt(
    donorName,
    sources.map(s => ({ ...s, source: 'tavily' })),
    '',
  );
}

export function calculateWeightedScore(scores: Record<string, number>): number {
  let total = 0;
  for (const dim of DIMENSIONS) {
    const key = dimKey(dim);
    const score = scores[key] || scores[dim.key] || 0;
    const weight = dim.tier === 'HIGH' ? 10 : dim.tier === 'MEDIUM' ? 7 : 3;
    total += weight * score;
  }
  return total;
}

export function selectTopSources(
  scoredSources: Array<{ source_index: number; total_score: number; word_count: number }>,
  sources: Array<{ content?: string; snippet: string }>,
  targetWords: number = 30000,
): Array<{ index: number; score: number; content: string }> {
  const sorted = [...scoredSources].sort((a, b) => b.total_score - a.total_score);
  const selected: Array<{ index: number; score: number; content: string }> = [];
  let cumulativeWords = 0;

  for (const scored of sorted) {
    const source = sources[scored.source_index - 1];
    if (!source) continue;
    const content = source.content || source.snippet;
    const wordCount = content.split(/\s+/).length;

    if (cumulativeWords + wordCount <= targetWords || selected.length === 0) {
      selected.push({ index: scored.source_index, score: scored.total_score, content });
      cumulativeWords += wordCount;
    }
    if (cumulativeWords >= targetWords) break;
  }

  return selected;
}
