// ARCHIVED: Legacy backward-compat exports removed from prompts/source-scoring.ts
// Date: February 2026
// Reason: Not called by any active code path per system audit
// Original location: prompts/source-scoring.ts ~line 639

import { DIMENSIONS, dimKey } from '../dimensions';

export const SOURCE_SCORING_PROMPT = 'DEPRECATED: Use runDimensionScoring() instead';

export function buildScoringPromptCompat(
  donorName: string,
  sources: { url: string; title: string; snippet: string; content?: string }[],
): string {
  // This was a backward-compat shim that mapped old-format sources to new buildScoringBatchPrompt
  const mapped = sources.map(s => ({ ...s, source: 'tavily' }));
  // Would call buildScoringBatchPrompt(donorName, mapped) but that function is not exported
  return `DEPRECATED: Use runDimensionScoring() instead. Donor: ${donorName}, Sources: ${mapped.length}`;
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
