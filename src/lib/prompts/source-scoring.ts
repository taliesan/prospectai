// Stage 5 — Dimension Scoring & Source Selection (v5 Pipeline)
//
// Stage 5a: Sonnet scores sources in parallel batches.
//   Each source gets integer depth scores (0-3) on 25 behavioral dimensions.
//   No selection, no gap report — scoring only.
//
// Stage 5b: Server-side selection algorithm (no LLM).
//   Iteratively picks the best source using scarcity-weighted scoring,
//   re-evaluates after each pick, fills a 100K char budget.
//   Gap report is a byproduct of the coverage tracking.

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

// ══════════════════════════════════════════════════════════════════════
// TUNABLE CONSTANTS — adjust after testing
// ══════════════════════════════════════════════════════════════════════

/** Dimension tier weights — how critical each dimension is */
export const TIER_WEIGHTS: Record<number, number> = {
  // High (1-7): ×3
  1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3,
  // Medium (8-15): ×2
  8: 2, 9: 2, 10: 2, 11: 2, 12: 2, 13: 2, 14: 2, 15: 2,
  // Low (16-25): ×1
  16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1, 22: 1, 23: 1, 24: 1, 25: 1,
};

/** How many evidence entries each dimension needs */
export const INVESTMENT_TARGETS: Record<number, number> = {
  // High (1-7): 7 (midpoint of 6-8)
  1: 7, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 7,
  // Medium (8-15): 5 (midpoint of 4-6)
  8: 5, 9: 5, 10: 5, 11: 5, 12: 5, 13: 5, 14: 5, 15: 5,
  // Low (16-25): 2 (midpoint of 1-3)
  16: 2, 17: 2, 18: 2, 19: 2, 20: 2, 21: 2, 22: 2, 23: 2, 24: 2, 25: 2,
};

/** Prevents one zero-coverage dimension from eating the whole budget */
export const SCARCITY_CAP = 6.0;

/** Mild nudge toward source-type diversity (index = sources of this tier already selected) */
export const DIVERSITY_BONUSES = [1.3, 1.15, 1.05, 1.0]; // 0 selected, 1, 2, 3+

/** Maximum chars of source content to send to Opus extraction+synthesis.
 *  150K (~37K tokens) uses more of Opus's 200K token context window,
 *  pulling in 15-25+ sources depending on length mix. */
export const CONTENT_BUDGET_CHARS = 150_000;

/** Domain concentration penalty thresholds.
 *  After 3 sources from one domain, apply 30% penalty to additional sources.
 *  After 5, apply 60%. Pushes algorithm to prefer diverse domains. */
export const DOMAIN_PENALTY_THRESHOLDS = [
  { after: 3, penalty: 0.30 },
  { after: 5, penalty: 0.60 },
] as const;

/** How many sources per Sonnet scoring batch */
const SCORING_BATCH_SIZE = 18;

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

export interface ScoredSource {
  url: string;
  title: string;
  attribution?: AttributionType;
  institutionalContext?: string;
  sourceTier: SourceTier;
  /** Dimension → depth score (integer 0-3). Only non-zero entries present. */
  depth_scores: Record<number, number>;
  content?: string;
  char_count: number;
  /** Legacy compat alias for depth_scores in string-keyed format */
  dimensionScores: Record<string, number>;
  /** Legacy compat field */
  contentLength: number;
  /** Original index in the input array (for debugging) */
  index: number;
}

export interface CoverageGap {
  dimension: string;
  dimId: number;
  count: number;
  target: string;
  status: 'SUFFICIENT' | 'GAP' | 'CRITICAL_GAP' | 'ZERO_COVERAGE';
}

export interface SelectionResult {
  selected: ScoredSource[];
  not_selected: ScoredSource[];
  coverage: Record<number, number>;
  gap_report: Record<number, {
    coverage_count: number;
    target: number;
    status: 'SUFFICIENT' | 'GAP' | 'CRITICAL_GAP' | 'ZERO_COVERAGE';
  }>;
  total_chars: number;
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

// ══════════════════════════════════════════════════════════════════════
// STAGE 5a — DEPTH SCORING (Sonnet, batched, parallel)
// ══════════════════════════════════════════════════════════════════════

/**
 * Build the scoring prompt for a single batch of sources.
 * Sonnet scores each source on the 25 dimensions using integer depth 0-3.
 */
function buildScoringBatchPrompt(
  subjectName: string,
  sources: ResearchSource[],
): string {
  const sourcesText = sources.map((s, i) => {
    const content = s.content || s.snippet || '';
    return `### Source ${i + 1}
URL: ${s.url}
Title: ${s.title || 'Untitled'}
Attribution: ${s.attribution || 'unknown'}
${s.institutionalContext ? `Institutional Context: ${s.institutionalContext}\n` : ''}
${content}`;
  }).join('\n\n---\n\n');

  return `You are scoring sources for a behavioral profiling system. For each source below, read the full content and score how much behavioral evidence it contains on each of the 25 dimensions listed.

SUBJECT: ${subjectName}

DEPTH SCALE (integer 0-3, per dimension, per source):
  0 = No evidence for this dimension
  1 = Mention — a fact without behavioral detail
      ("MacDougall joined the board")
  2 = Passage — a paragraph describing a decision, action, or
      behavioral moment with context
  3 = Rich evidence — direct quotes showing how they think,
      observable behavior under pressure, or multiple data points

Score based on what the content ACTUALLY CONTAINS. Do not infer.

THE 25 DIMENSIONS:

HIGH INVESTMENT (1-7):
 1. DECISION_MAKING — How they evaluate proposals and opportunities
 2. TRUST_CALIBRATION — What builds or breaks credibility
 3. COMMUNICATION_STYLE — Language patterns, directness, framing
 4. IDENTITY_SELF_CONCEPT — How they see and present themselves
 5. VALUES_HIERARCHY — What they prioritize when values conflict
 6. CONTRADICTION_PATTERNS — Where stated values and actions diverge
 7. POWER_ANALYSIS — How they read, navigate, and deploy power

MEDIUM INVESTMENT (8-15):
 8. INFLUENCE_SUSCEPTIBILITY — What persuades them, resistance patterns
 9. TIME_ORIENTATION — Past/present/future emphasis, urgency triggers
10. BOUNDARY_CONDITIONS — Hard limits and non-negotiables
11. EMOTIONAL_TRIGGERS — What excites or irritates them
12. RELATIONSHIP_PATTERNS — Loyalty, collaboration style
13. RISK_TOLERANCE — Attitude toward uncertainty and failure
14. RESOURCE_PHILOSOPHY — How they think about money, time, leverage
15. COMMITMENT_PATTERNS — How they make and keep commitments

LOW INVESTMENT (16-25):
16. LEARNING_STYLE — How they take in new information
17. STATUS_RECOGNITION — How they relate to prestige and credit
18. KNOWLEDGE_AREAS — Domains of expertise and intellectual passion
19. RETREAT_PATTERNS — How they disengage, recover, reset
20. SHAME_DEFENSE_TRIGGERS — What they protect, what feels threatening
21. REAL_TIME_INTERPERSONAL_TELLS — Observable behavior in interaction
22. TEMPO_MANAGEMENT — Pacing of decisions, conversations, projects
23. HIDDEN_FRAGILITIES — Vulnerabilities they manage or compensate for
24. RECOVERY_PATHS — How they bounce back from setbacks
25. CONDITIONAL_BEHAVIORAL_FORKS — If X, they do Y; if not X, they do Z

ALSO CLASSIFY EACH SOURCE INTO A SOURCE TIER:
  Tier 1: Podcast/interview/video — unscripted voice
  Tier 2: Press profile, journalist coverage, third-party analysis
  Tier 3: Self-authored (op-eds, LinkedIn posts, blog, Substack)
  Tier 4: Institutional evidence during tenure (inferential)
  Tier 5: Structural records (board filings, 990s, lobbying registries)

SOURCES TO SCORE:
${sourcesText}

OUTPUT — JSON array, one object per source:
[
  {
    "url": "https://example.com/article",
    "source_tier": 2,
    "depth_scores": {
      "1": 2, "4": 3, "7": 1, "8": 2, "25": 1
    }
  }
]

Only include dimensions with non-zero scores in depth_scores. Every source must appear in the output — do not skip any.`;
}

/**
 * Score a single batch of sources via Sonnet. Returns ScoredSource[] for the batch.
 */
async function scoreBatch(
  subjectName: string,
  batch: ResearchSource[],
  batchOffset: number,
): Promise<ScoredSource[]> {
  const prompt = buildScoringBatchPrompt(subjectName, batch);

  const response = await complete(
    'You are scoring research sources for behavioral evidence. Return JSON only.',
    prompt,
    { maxTokens: 8192 },
  );

  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.warn(`[Stage 5a] Batch at offset ${batchOffset}: no JSON array found, scoring as all-zeros`);
    return batch.map((s, j) => makeZeroScoredSource(s, batchOffset + j));
  }

  const parsed: Array<{
    url?: string;
    source_tier?: number;
    depth_scores?: Record<string, number>;
  }> = JSON.parse(jsonMatch[0]);

  const results: ScoredSource[] = [];
  const handledIndices = new Set<number>();

  for (let k = 0; k < parsed.length; k++) {
    const entry = parsed[k];
    // Match by position (k) since Sonnet outputs in order
    const sourceIdx = k < batch.length ? k : -1;
    if (sourceIdx < 0) continue;
    handledIndices.add(sourceIdx);

    const source = batch[sourceIdx];
    const depthScores: Record<number, number> = {};
    const dimensionScores: Record<string, number> = {};

    if (entry.depth_scores) {
      for (const [dimStr, score] of Object.entries(entry.depth_scores)) {
        const dimId = parseInt(dimStr, 10);
        if (dimId >= 1 && dimId <= 25 && typeof score === 'number') {
          const clampedScore = Math.min(3, Math.max(0, Math.round(score)));
          if (clampedScore > 0) {
            depthScores[dimId] = clampedScore;
            // Legacy compat: convert to 0.0-1.0 scale string-keyed format
            const dim = DIMENSIONS.find(d => d.id === dimId);
            if (dim) {
              dimensionScores[dimKey(dim)] = clampedScore / 3;
            }
          }
        }
      }
    }

    const charCount = (source.content || source.snippet || '').length;
    results.push({
      index: batchOffset + sourceIdx,
      url: source.url,
      title: source.title,
      attribution: source.attribution,
      institutionalContext: source.institutionalContext,
      sourceTier: (entry.source_tier || 3) as SourceTier,
      depth_scores: depthScores,
      dimensionScores,
      content: source.content,
      char_count: charCount,
      contentLength: charCount,
    });
  }

  // Handle any sources not covered by the response
  for (let j = 0; j < batch.length; j++) {
    if (!handledIndices.has(j)) {
      results.push(makeZeroScoredSource(batch[j], batchOffset + j));
    }
  }

  return results;
}

/**
 * Create a ScoredSource with all-zero depth scores (for failed batches or missing sources).
 */
function makeZeroScoredSource(source: ResearchSource, index: number): ScoredSource {
  const charCount = (source.content || source.snippet || '').length;
  return {
    index,
    url: source.url,
    title: source.title,
    attribution: source.attribution,
    institutionalContext: source.institutionalContext,
    sourceTier: 3 as SourceTier,
    depth_scores: {},
    dimensionScores: {},
    content: source.content,
    char_count: charCount,
    contentLength: charCount,
  };
}

/**
 * Stage 5a: Score all sources in parallel batches via Sonnet.
 * Splits into batches of SCORING_BATCH_SIZE, runs all concurrently,
 * merges into one flat array.
 */
async function scoreAllSources(
  sources: ResearchSource[],
  subjectName: string,
): Promise<ScoredSource[]> {
  const batches: { batch: ResearchSource[]; offset: number }[] = [];
  for (let i = 0; i < sources.length; i += SCORING_BATCH_SIZE) {
    batches.push({
      batch: sources.slice(i, i + SCORING_BATCH_SIZE),
      offset: i,
    });
  }

  console.log(`[Stage 5a] Scoring ${sources.length} sources in ${batches.length} parallel batches of ≤${SCORING_BATCH_SIZE}`);

  // Run all batches in parallel
  const batchResults = await Promise.all(
    batches.map(async ({ batch, offset }, batchIdx) => {
      try {
        const result = await scoreBatch(subjectName, batch, offset);
        console.log(`[Stage 5a] Batch ${batchIdx + 1}/${batches.length}: scored ${result.length} sources`);
        return result;
      } catch (err) {
        console.error(`[Stage 5a] Batch ${batchIdx + 1} failed, retrying once...`, err);
        // Retry once
        try {
          const result = await scoreBatch(subjectName, batch, offset);
          console.log(`[Stage 5a] Batch ${batchIdx + 1}/${batches.length}: scored ${result.length} sources (retry)`);
          return result;
        } catch (retryErr) {
          console.error(`[Stage 5a] Batch ${batchIdx + 1} failed on retry, scoring as all-zeros`, retryErr);
          return batch.map((s, j) => makeZeroScoredSource(s, offset + j));
        }
      }
    })
  );

  // Merge all batch results into one flat array
  const allScored = batchResults.flat();
  console.log(`[Stage 5a] Total scored: ${allScored.length} sources`);
  return allScored;
}

// ══════════════════════════════════════════════════════════════════════
// STAGE 5b — SOURCE SELECTION ALGORITHM (server code, no LLM)
// ══════════════════════════════════════════════════════════════════════

/** Extract the registrable domain from a URL (e.g. "intangible.ca" from "https://www.intangible.ca/foo") */
function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return hostname;
  } catch {
    return url;
  }
}

/**
 * Iteratively select sources using scarcity-weighted scoring.
 * After each pick, scarcity recalculates because coverage changes.
 */
export function selectSources(allScored: ScoredSource[]): SelectionResult {
  const selected: ScoredSource[] = [];
  const remaining = [...allScored];
  let totalChars = 0;

  // Coverage per dimension: how many selected sources have depth > 0
  const coverage: Record<number, number> = {};
  for (let d = 1; d <= 25; d++) coverage[d] = 0;

  // Source tier counts for diversity bonus
  const tierCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  // Domain counts for concentration penalty
  const domainCounts: Record<string, number> = {};

  while (remaining.length > 0) {
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const src = remaining[i];

      // Calculate: Σ(depth × tier_weight × scarcity) × diversity_bonus / char_count × 1000
      let dimSum = 0;
      for (let d = 1; d <= 25; d++) {
        const depth = src.depth_scores[d] || 0;
        if (depth === 0) continue;

        const tierWeight = TIER_WEIGHTS[d];
        const target = INVESTMENT_TARGETS[d];
        const scarcity = Math.min(
          target / Math.max(coverage[d], 0.5),
          SCARCITY_CAP
        );
        dimSum += depth * tierWeight * scarcity;
      }

      const tierCount = tierCounts[src.sourceTier] || 0;
      const diversityBonus = DIVERSITY_BONUSES[Math.min(tierCount, 3)];

      // Domain concentration penalty: penalize sources from overrepresented domains
      const srcDomain = extractDomain(src.url);
      const domainCount = domainCounts[srcDomain] || 0;
      let domainPenaltyFactor = 1.0;
      for (const { after, penalty } of DOMAIN_PENALTY_THRESHOLDS) {
        if (domainCount >= after) {
          domainPenaltyFactor = 1.0 - penalty;
        }
      }

      // Guard against zero-length sources
      const charCount = Math.max(src.char_count, 1);
      const score = (dimSum * diversityBonus * domainPenaltyFactor) / charCount * 1000;

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    // No source with positive signal remaining — we're done
    if (bestIdx === -1 || bestScore <= 0) break;

    // Budget check: stop if adding this source would exceed the char budget
    const chosen = remaining.splice(bestIdx, 1)[0];
    if (totalChars + chosen.char_count > CONTENT_BUDGET_CHARS && selected.length > 0) {
      // Put it back and stop — we've hit the budget
      remaining.push(chosen);
      break;
    }

    selected.push(chosen);
    totalChars += chosen.char_count;

    // Update coverage for all dimensions this source covers
    for (let d = 1; d <= 25; d++) {
      if ((chosen.depth_scores[d] || 0) > 0) {
        coverage[d]++;
      }
    }

    // Update tier count and domain count
    tierCounts[chosen.sourceTier]++;
    const chosenDomain = extractDomain(chosen.url);
    domainCounts[chosenDomain] = (domainCounts[chosenDomain] || 0) + 1;

    // Scarcity recalculates automatically on next loop iteration
    // because it reads from the updated coverage object
  }

  // ── Knapsack backfill: fill remaining budget with smaller high-value sources ──
  // The greedy pass may leave budget unused because the next-ranked source was
  // too large to fit. Scan remaining sources smallest-to-largest and add any
  // that fit and have signal on at least 2 dimensions.
  const budgetRemaining = CONTENT_BUDGET_CHARS - totalChars;
  if (budgetRemaining > 0) {
    const backfillCandidates = remaining
      .map((s, idx) => ({ s, idx }))
      .filter(({ s }) => {
        const nonZeroDims = Object.values(s.depth_scores).filter(v => v > 0).length;
        return nonZeroDims >= 2 && s.char_count <= budgetRemaining;
      })
      .sort((a, b) => a.s.char_count - b.s.char_count);

    let backfillChars = 0;
    const backfillIndices = new Set<number>();
    for (const { s, idx } of backfillCandidates) {
      if (totalChars + backfillChars + s.char_count > CONTENT_BUDGET_CHARS) continue;
      backfillChars += s.char_count;
      backfillIndices.add(idx);
      selected.push(s);

      // Update coverage and domain counts
      for (let d = 1; d <= 25; d++) {
        if ((s.depth_scores[d] || 0) > 0) coverage[d]++;
      }
      tierCounts[s.sourceTier]++;
      const bfDomain = extractDomain(s.url);
      domainCounts[bfDomain] = (domainCounts[bfDomain] || 0) + 1;
    }

    // Remove backfilled sources from remaining (reverse order to preserve indices)
    const sortedIndices = Array.from(backfillIndices).sort((a, b) => b - a);
    for (const idx of sortedIndices) {
      remaining.splice(idx, 1);
    }

    totalChars += backfillChars;
    if (backfillIndices.size > 0) {
      console.log(`[Stage 5b] Backfill: added ${backfillIndices.size} smaller sources (~${backfillChars} chars), total now ${totalChars} chars`);
    }
  }

  // Build gap report from final coverage state
  const gap_report: SelectionResult['gap_report'] = {};
  for (let d = 1; d <= 25; d++) {
    const target = INVESTMENT_TARGETS[d];
    const count = coverage[d];
    let status: 'SUFFICIENT' | 'GAP' | 'CRITICAL_GAP' | 'ZERO_COVERAGE';
    if (count === 0) status = 'ZERO_COVERAGE';
    else if (count < target * 0.5) status = 'CRITICAL_GAP';
    else if (count < target) status = 'GAP';
    else status = 'SUFFICIENT';
    gap_report[d] = { coverage_count: count, target, status };
  }

  return {
    selected,
    not_selected: remaining,
    coverage,
    gap_report,
    total_chars: totalChars,
  };
}

// ══════════════════════════════════════════════════════════════════════
// GAP REPORT FORMATTING (for Stage 6 developer message, Section C)
// ══════════════════════════════════════════════════════════════════════

const DIMENSION_NAMES: Record<number, string> = {
  // HIGH (1-7)
  1: 'DECISION_MAKING', 2: 'TRUST_CALIBRATION', 3: 'COMMUNICATION_STYLE',
  4: 'IDENTITY_SELF_CONCEPT', 5: 'VALUES_HIERARCHY', 6: 'CONTRADICTION_PATTERNS',
  7: 'POWER_ANALYSIS',
  // MEDIUM (8-15)
  8: 'INFLUENCE_SUSCEPTIBILITY', 9: 'TIME_ORIENTATION',
  10: 'BOUNDARY_CONDITIONS', 11: 'EMOTIONAL_TRIGGERS', 12: 'RELATIONSHIP_PATTERNS',
  13: 'RISK_TOLERANCE', 14: 'RESOURCE_PHILOSOPHY', 15: 'COMMITMENT_PATTERNS',
  // LOW (16-25)
  16: 'LEARNING_STYLE', 17: 'STATUS_RECOGNITION', 18: 'KNOWLEDGE_AREAS',
  19: 'RETREAT_PATTERNS', 20: 'SHAME_DEFENSE_TRIGGERS',
  21: 'REAL_TIME_INTERPERSONAL_TELLS', 22: 'TEMPO_MANAGEMENT',
  23: 'HIDDEN_FRAGILITIES', 24: 'RECOVERY_PATHS', 25: 'CONDITIONAL_BEHAVIORAL_FORKS',
};

/**
 * Format the gap report from the selection algorithm for Stage 6 developer message (Section C).
 * Input can be either the SelectionResult.gap_report or the legacy CoverageGap[] format.
 */
export function formatCoverageGapReport(
  input: SelectionResult['gap_report'] | CoverageGap[],
): string {
  const lines: string[] = [
    'COVERAGE GAP ANALYSIS FROM PRE-RESEARCH:',
    'The following dimensions have weak or zero coverage in the pre-loaded',
    'sources. After you have fully processed all pre-fetched sources,',
    'conduct a LIMITED round of web searches (no more than 15-20 searches)',
    'targeting these specific gaps:',
    '',
  ];

  // Normalize input to entries
  let entries: Array<{ dim: number; coverage_count: number; target: number; status: string }>;

  if (Array.isArray(input)) {
    // Legacy CoverageGap[] format
    entries = input.map(g => ({
      dim: g.dimId,
      coverage_count: g.count,
      target: INVESTMENT_TARGETS[g.dimId] || 2,
      status: g.status,
    }));
  } else {
    // New SelectionResult.gap_report format
    entries = Object.entries(input).map(([d, info]) => ({
      dim: Number(d),
      ...info,
    }));
  }

  // Filter to non-sufficient and sort: ZERO_COVERAGE first, then CRITICAL_GAP, then GAP
  const priority: Record<string, number> = { ZERO_COVERAGE: 0, CRITICAL_GAP: 1, GAP: 2, SUFFICIENT: 3 };
  const gaps = entries
    .filter(e => e.status !== 'SUFFICIENT')
    .sort((a, b) => (priority[a.status] ?? 4) - (priority[b.status] ?? 4));

  for (const e of gaps) {
    lines.push(
      `${e.dim}. ${DIMENSION_NAMES[e.dim]} — ${e.status} ` +
      `(${e.coverage_count} sources, need ${e.target})`
    );
  }

  if (gaps.length === 0) {
    lines.push('All dimensions have sufficient coverage. Gap-fill search is optional.');
  }

  return lines.join('\n');
}

// ══════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT — runDimensionScoring
// ══════════════════════════════════════════════════════════════════════

/**
 * Run Stage 5: Score all sources (5a) then select via algorithm (5b).
 * Returns selected sources + gap report for Stage 6.
 */
export async function runDimensionScoring(
  sources: ResearchSource[],
  subjectName: string,
  identity: any,
  linkedinData?: any,
): Promise<Stage5Result> {
  console.log(`[Stage 5] Scoring ${sources.length} sources against 25 dimensions`);

  // Content diagnostics — surfaces fetch failures before scoring
  const thinSources = sources.filter(s => (s.content || s.snippet || '').length < 500);
  const emptySources = sources.filter(s => (s.content || s.snippet || '').length === 0);
  if (thinSources.length > 0) {
    console.warn(`[Stage 5] Content warning: ${thinSources.length} sources have <500 chars (${emptySources.length} empty)`);
    for (const s of thinSources.slice(0, 10)) {
      console.warn(`[Stage 5]   THIN: ${s.url} (${(s.content || s.snippet || '').length} chars)`);
    }
  }

  // ── Stage 5a: Parallel batched scoring ──────────────────────────
  const allScored = await scoreAllSources(sources, subjectName);
  console.log(`[Stage 5a] Scored ${allScored.length} sources`);

  // Zero-score diagnostics — helps differentiate fetch problems from scoring prompt problems
  const zeroScored = allScored.filter(s => Object.keys(s.depth_scores).length === 0);
  const nonZeroScored = allScored.filter(s => Object.keys(s.depth_scores).length > 0);
  console.log(`[Stage 5a] Score distribution: ${nonZeroScored.length} with signal, ${zeroScored.length} all-zero`);
  if (zeroScored.length > 0) {
    // Group zero-scored by content length to identify fetch vs scoring issues
    const zeroWithContent = zeroScored.filter(s => s.char_count >= 500);
    const zeroThin = zeroScored.filter(s => s.char_count > 0 && s.char_count < 500);
    const zeroEmpty = zeroScored.filter(s => s.char_count === 0);
    console.log(`[Stage 5a] Zero-scored breakdown: ${zeroEmpty.length} empty, ${zeroThin.length} thin (<500 chars), ${zeroWithContent.length} with content (>=500 chars)`);
    if (zeroWithContent.length > 0) {
      console.warn(`[Stage 5a] *** ${zeroWithContent.length} sources have real content but scored zero — possible scoring prompt issue ***`);
      for (const s of zeroWithContent.slice(0, 5)) {
        console.warn(`[Stage 5a]   CONTENT BUT ZERO: ${s.url} (${s.char_count} chars, tier ${s.sourceTier})`);
      }
    }
  }

  // ── Stage 5b: Iterative selection algorithm (no LLM) ───────────
  const selectionResult = selectSources(allScored);

  console.log(`[Stage 5b] Selected ${selectionResult.selected.length} sources (~${selectionResult.total_chars} chars)`);
  console.log(`[Stage 5b] Not selected: ${selectionResult.not_selected.length} sources`);

  // Log coverage summary
  for (let d = 1; d <= 25; d++) {
    const info = selectionResult.gap_report[d];
    if (info.status !== 'SUFFICIENT') {
      console.log(`[Stage 5b] ${info.status}: ${DIMENSION_NAMES[d]} (${info.coverage_count} sources, need ${info.target})`);
    }
  }

  // Convert SelectionResult.gap_report to CoverageGap[] for backward compat
  const coverageGaps: CoverageGap[] = [];
  for (let d = 1; d <= 25; d++) {
    const info = selectionResult.gap_report[d];
    const dim = DIMENSIONS.find(dd => dd.id === d)!;
    coverageGaps.push({
      dimension: dimKey(dim),
      dimId: d,
      count: info.coverage_count,
      target: `${dim.targetMin}-${dim.targetMax}`,
      status: info.status,
    });
  }

  // Build notSelected reasons for logging — differentiate zero-scored from budget/rank excluded
  const notSelected = selectionResult.not_selected.map(s => {
    const nonZeroDims = Object.values(s.depth_scores).filter(v => v > 0).length;
    const totalDepth = Object.values(s.depth_scores).reduce((sum, v) => sum + v, 0);
    if (nonZeroDims === 0) {
      return { url: s.url, reason: `Zero behavioral signal (all dimension scores = 0, content: ${s.char_count} chars)` };
    }
    return { url: s.url, reason: `Budget/rank excluded (scored ${nonZeroDims} dims, total depth ${totalDepth}, content: ${s.char_count} chars)` };
  });

  return {
    selectedSources: selectionResult.selected,
    notSelected,
    coverageGaps,
    stats: {
      totalScored: allScored.length,
      selected: selectionResult.selected.length,
      estimatedContentChars: selectionResult.total_chars,
    },
  };
}

// ══════════════════════════════════════════════════════════════════════
// FORMAT SELECTED SOURCES FOR STAGE 6 USER MESSAGE
// ══════════════════════════════════════════════════════════════════════

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

    // List covered dimensions with their depth scores
    const dimCoverage = Object.entries(s.depth_scores)
      .filter(([, score]) => score > 0)
      .map(([dimId, score]) => `${DIMENSION_NAMES[Number(dimId)]}(${score})`)
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

// Backward-compat exports archived to _archived/source-scoring-legacy.ts:
// SOURCE_SCORING_PROMPT, buildScoringPromptCompat, calculateWeightedScore, selectTopSources
