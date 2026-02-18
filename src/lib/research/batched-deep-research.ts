// Stage 6 — Batched Evidence Extraction + Gap-Fill (v5 Pipeline)
//
// Source batches (1-3) run on Sonnet — structured extraction from pre-fetched text.
// Gap-fill runs on DR (Deep Research) — the only batch that actually needs web search.
//
// Batch 1: Richest sources + empty scaffold + extraction instructions + gap report  → Sonnet
// Batch 2: Next sources + accumulated evidence + updated coverage map               → Sonnet
// Batch 3: Next sources + accumulated evidence + updated coverage map               → Sonnet
// Gap-fill: No sources. Full accumulated evidence. Web search for thin dimensions.  → DR
//
// Source batches: ~20-40s each via Sonnet. Standard API retry (2 attempts).
// Gap-fill: 5-10 min via DR with stall detection + retry.

import { writeFileSync, mkdirSync } from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { formatDimensionsForPrompt } from '../dimensions';
import type { LinkedInData } from '../prompts/extraction-prompt';
import type { ScoredSource, CoverageGap } from '../prompts/source-scoring';
import { formatCoverageGapReport } from '../prompts/source-scoring';
import { SOURCE_TIER_LABELS } from '../dimensions';
import type { ActivityCallback } from '../job-store';
import {
  type CumulativeEvidence,
  createEmptyScaffold,
  mergeEvidence,
  buildCoverageMap,
  formatCoverageMapForBatch,
  formatEvidenceForNextBatch,
  formatEvidenceAsDossier,
  CUMULATIVE_EVIDENCE_SCHEMA,
  ALL_DIM_KEYS,
} from './cumulative-evidence';
import {
  executeDeepResearch,
  type DeepResearchResult,
  type DeepResearchCitation,
} from './deep-research';

// ── Constants ─────────────────────────────────────────────────────

/** Maximum chars of source content per batch */
const BATCH_CHAR_CEILING = 30_000;

/** Maximum number of source batches (not counting gap-fill) */
const MAX_SOURCE_BATCHES = 3;

// Source batches (Sonnet): standard API retry, 2 attempts. No stall detection needed.
// Gap-fill batch (DR): 10 min stall detection handled by executeDeepResearch
// stream/polling layer, with runBatchWithRetry providing 2 attempts.

type ProgressCallback = (message: string, phase?: string, step?: number, totalSteps?: number) => void;

// ── Dimension name lookup (mirrors source-scoring.ts) ─────────────

const DIMENSION_NAMES: Record<number, string> = {
  1: 'DECISION_MAKING', 2: 'TRUST_CALIBRATION', 3: 'COMMUNICATION_STYLE',
  4: 'IDENTITY_SELF_CONCEPT', 5: 'VALUES_HIERARCHY', 6: 'CONTRADICTION_PATTERNS',
  7: 'POWER_ANALYSIS',
  8: 'INFLUENCE_SUSCEPTIBILITY', 9: 'TIME_ORIENTATION',
  10: 'BOUNDARY_CONDITIONS', 11: 'EMOTIONAL_TRIGGERS', 12: 'RELATIONSHIP_PATTERNS',
  13: 'RISK_TOLERANCE', 14: 'RESOURCE_PHILOSOPHY', 15: 'COMMITMENT_PATTERNS',
  16: 'LEARNING_STYLE', 17: 'STATUS_RECOGNITION', 18: 'KNOWLEDGE_AREAS',
  19: 'RETREAT_PATTERNS', 20: 'SHAME_DEFENSE_TRIGGERS',
  21: 'REAL_TIME_INTERPERSONAL_TELLS', 22: 'TEMPO_MANAGEMENT',
  23: 'HIDDEN_FRAGILITIES', 24: 'RECOVERY_PATHS', 25: 'CONDITIONAL_BEHAVIORAL_FORKS',
};

// ── Batch packing ─────────────────────────────────────────────────

interface SourceBatch {
  sources: ScoredSource[];
  totalChars: number;
  batchNumber: number;
}

function packBatches(rankedSources: ScoredSource[]): SourceBatch[] {
  const batches: SourceBatch[] = [];
  let currentBatch: ScoredSource[] = [];
  let currentChars = 0;

  for (const source of rankedSources) {
    const charCount = source.char_count || (source.content || '').length;

    // If adding this source exceeds ceiling and we have sources, start new batch
    if (currentChars + charCount > BATCH_CHAR_CEILING && currentBatch.length > 0) {
      batches.push({
        sources: currentBatch,
        totalChars: currentChars,
        batchNumber: batches.length + 1,
      });

      if (batches.length >= MAX_SOURCE_BATCHES) break;

      currentBatch = [];
      currentChars = 0;
    }

    // If we're at max batches, stop
    if (batches.length >= MAX_SOURCE_BATCHES) break;

    currentBatch.push(source);
    currentChars += charCount;
  }

  // Push final batch if non-empty and under limit
  if (currentBatch.length > 0 && batches.length < MAX_SOURCE_BATCHES) {
    batches.push({
      sources: currentBatch,
      totalChars: currentChars,
      batchNumber: batches.length + 1,
    });
  }

  return batches;
}

// ── Format sources for a batch's user message ─────────────────────

function formatBatchSources(batch: SourceBatch): string {
  const lines: string[] = [];
  lines.push(`PRE-FETCHED SOURCE MATERIAL (Batch ${batch.batchNumber}):`);
  lines.push(`${batch.sources.length} sources, ~${Math.round(batch.totalChars / 1000)}K chars.\n`);

  for (let i = 0; i < batch.sources.length; i++) {
    const s = batch.sources[i];
    const content = s.content || '';

    const dimCoverage = Object.entries(s.depth_scores)
      .filter(([, score]) => score > 0)
      .map(([dimId, score]) => `${DIMENSION_NAMES[Number(dimId)]}(${score})`)
      .join(', ');

    lines.push(`=== SOURCE ${i + 1} of ${batch.sources.length} ===`);
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

// ── Developer message builders ────────────────────────────────────

function buildBatch1DeveloperMessage(
  subjectName: string,
  numSources: number,
  coverageGapReport: string,
  linkedinJson: string,
): string {
  return `You are a behavioral research analyst producing a structured evidence dossier on ${subjectName}. Your output feeds a downstream profiling system.

TASK: Read every pre-fetched source. Extract behavioral evidence as key quotes (50-300 words). Tag each quote to behavioral dimensions. Identify cross-source patterns and contradictions.

This is BATCH 1 of a multi-batch extraction process. You are processing the highest-signal sources first. Later batches will receive your accumulated evidence and build on it.

ANALYTICAL REGISTER: When you write analysis, write what the behavior looks like in the room and what it means for someone sitting across the table. Do not write personality descriptions or academic behavioral analysis.

Right: "He gave $25K, then $100K, then $1.2M to the same org over four years. He doesn't decide once — he decides in stages, and each stage is a test."
Wrong: "His grant-making history suggests he calibrates trust through incremental commitment."

Right: "She told a panel audience 'that's a bad question' and then answered the question she thought they should have asked."
Wrong: "Her public statements reveal a communication style characterized by directness and analytical rigor."

SOURCE ATTRIBUTION:
- "target_authored" — Direct voice. Quote the subject's own words.
- "target_coverage" — Third-party coverage. Quote only passages where the subject is directly quoted or their specific actions are described.
- "institutional_inference" — What the org did during the subject's tenure, in their area of responsibility. Extract the institutional action. Tag as institutional inference.
- "target_reshare" — Extract ONLY the subject's original commentary.

BEHAVIORAL DIMENSIONS:
${formatDimensionsForPrompt()}

${coverageGapReport}

CANONICAL BIOGRAPHICAL DATA:
${linkedinJson}

YOU MUST read every one of the ${numSources} pre-fetched sources and extract all behavioral evidence.

OUTPUT FORMAT — Return valid JSON matching this schema:
${CUMULATIVE_EVIDENCE_SCHEMA}

Return ONLY the JSON object. No markdown fences, no commentary before or after.`;
}

function buildBatchNDeveloperMessage(
  subjectName: string,
  batchNumber: number,
  numSources: number,
  coverageMapText: string,
  linkedinJson: string,
): string {
  return `You are a behavioral research analyst continuing a multi-batch extraction on ${subjectName}. This is BATCH ${batchNumber}.

CONTEXT: Previous batches have already extracted evidence from higher-signal sources. The accumulated evidence and current coverage map are provided in the user message. You will receive ${numSources} new sources to process.

YOUR JOB FOR THIS BATCH:
1. Read all ${numSources} new sources
2. Extract behavioral evidence as key quotes (50-300 words each)
3. Focus on: CONFIRMING patterns seen in prior evidence, CONTRADICTING prior findings (these are especially valuable), EXTENDING thin dimensions, FILLING dimensions with ZERO or THIN coverage
4. For dimensions already at STRONG coverage, only extract evidence that contradicts or meaningfully extends existing findings
5. Identify new cross-source patterns that emerge from combining this batch with prior evidence
6. Flag contradictions between this batch's evidence and prior batches

ANALYTICAL REGISTER: Write what the behavior looks like in the room. Not personality descriptions.

${coverageMapText}

Dimensions marked ZERO_COVERAGE or CRITICAL_GAP need the most attention. Squeeze these sources for whatever they contribute to underserved dimensions.

SOURCE ATTRIBUTION:
- "target_authored" — Direct voice. Quote the subject's own words.
- "target_coverage" — Quote only passages with direct quotes or described actions.
- "institutional_inference" — Extract institutional actions during tenure.
- "target_reshare" — Extract ONLY the subject's original commentary.

BEHAVIORAL DIMENSIONS:
${formatDimensionsForPrompt()}

CANONICAL BIOGRAPHICAL DATA:
${linkedinJson}

OUTPUT FORMAT — Return valid JSON matching this schema:
${CUMULATIVE_EVIDENCE_SCHEMA}

IMPORTANT: Your output should contain ONLY the NEW evidence from this batch's sources. Do not repeat quotes already in the accumulated evidence. The system will merge your output into the accumulated evidence automatically.

Return ONLY the JSON object. No markdown fences, no commentary before or after.`;
}

function buildGapFillDeveloperMessage(
  subjectName: string,
  coverageMapText: string,
  linkedinJson: string,
): string {
  return `You are a behavioral research analyst performing a final gap-fill pass on ${subjectName}. No pre-fetched sources — only web search.

CONTEXT: Multiple batches of source extraction are complete. The accumulated evidence and current coverage map are provided in the user message.

YOUR JOB:
1. Review the coverage map for dimensions with ZERO_COVERAGE, CRITICAL_GAP, or THIN strength
2. Conduct targeted web searches for those specific gaps (max 15-20 searches)
3. Extract behavioral evidence from any useful results
4. Do NOT search for dimensions already at STRONG or MODERATE coverage unless you see an opportunity to identify a contradiction
5. If a search returns nothing useful, report the gap honestly. An honest "no evidence found" is better than thin inference.

ANALYTICAL REGISTER: Write what the behavior looks like in the room. Not personality descriptions.

${coverageMapText}

SOURCE ATTRIBUTION:
- Tag new evidence based on the source type you find (target_authored, target_coverage, institutional_inference)

BEHAVIORAL DIMENSIONS:
${formatDimensionsForPrompt()}

CANONICAL BIOGRAPHICAL DATA:
${linkedinJson}

OUTPUT FORMAT — Return valid JSON matching this schema:
${CUMULATIVE_EVIDENCE_SCHEMA}

Your output should contain ONLY the NEW evidence from gap-fill searches. The system will merge it into accumulated evidence automatically.

Return ONLY the JSON object. No markdown fences, no commentary before or after.`;
}

// ── Parse JSON from DR output ─────────────────────────────────────

function parseCumulativeEvidenceFromOutput(dossier: string): CumulativeEvidence | null {
  // Try direct JSON parse first
  try {
    const parsed = JSON.parse(dossier.trim());
    if (parsed.dimensions) return validateAndNormalize(parsed);
  } catch { /* not raw JSON */ }

  // Try extracting from markdown fences
  const fenceMatch = dossier.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (parsed.dimensions) return validateAndNormalize(parsed);
    } catch { /* bad JSON in fence */ }
  }

  // Try finding outermost { ... }
  const braceStart = dossier.indexOf('{');
  const braceEnd = dossier.lastIndexOf('}');
  if (braceStart >= 0 && braceEnd > braceStart) {
    try {
      const parsed = JSON.parse(dossier.slice(braceStart, braceEnd + 1));
      if (parsed.dimensions) return validateAndNormalize(parsed);
    } catch { /* bad JSON */ }
  }

  return null;
}

function validateAndNormalize(raw: any): CumulativeEvidence {
  const scaffold = createEmptyScaffold();

  // Merge raw dimensions into scaffold (handles missing keys gracefully)
  if (raw.dimensions && typeof raw.dimensions === 'object') {
    for (const key of ALL_DIM_KEYS) {
      const rawDim = raw.dimensions[key];
      if (!rawDim) continue;

      scaffold.dimensions[key] = {
        quotes: Array.isArray(rawDim.quotes)
          ? rawDim.quotes.map((q: any) => ({
              text: String(q.text || ''),
              source_url: String(q.source_url || ''),
              depth: [1, 2, 3].includes(q.depth) ? q.depth : 1,
            }))
          : [],
        analysis: String(rawDim.analysis || ''),
        coverage_count: typeof rawDim.coverage_count === 'number' ? rawDim.coverage_count : 0,
        strength: ['ZERO', 'THIN', 'MODERATE', 'STRONG'].includes(rawDim.strength) ? rawDim.strength : 'ZERO',
      };

      // Fix coverage_count if it doesn't match actual quotes
      scaffold.dimensions[key].coverage_count = scaffold.dimensions[key].quotes.length;
    }
  }

  scaffold.cross_source_patterns = Array.isArray(raw.cross_source_patterns)
    ? raw.cross_source_patterns.map(String)
    : [];

  scaffold.contradictions = Array.isArray(raw.contradictions)
    ? raw.contradictions.map(String)
    : [];

  scaffold.sources_processed = Array.isArray(raw.sources_processed)
    ? raw.sources_processed.map(String)
    : [];

  return scaffold;
}

// ── Run a source batch via Sonnet ──────────────────────────────────

const sonnet = new Anthropic();
const SONNET_MODEL = 'claude-sonnet-4-5-20250929';

async function executeSourceBatchWithSonnet(
  label: string,
  developerMessage: string,
  userMessage: string,
  onProgress?: ProgressCallback,
  abortSignal?: AbortSignal,
  onActivity?: ActivityCallback,
): Promise<{ evidence: CumulativeEvidence | null; durationMs: number; tokenUsage: any }> {

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');

    console.log(`[Batched Sonnet] ${label} attempt ${attempt}`);
    const t0 = Date.now();

    try {
      onActivity?.({
        openaiStatus: 'in_progress',
        totalOutputItems: 0,
        searches: 0,
        pageVisits: 0,
        reasoningSteps: 0,
        codeExecutions: 0,
        recentSearchQueries: [],
        reasoningSummary: [`[Sonnet] ${label}${attempt > 1 ? ` (retry ${attempt})` : ''}`],
        hasMessage: false,
        elapsedSeconds: 0,
      }, `sonnet-${label}`);

      const response = await sonnet.messages.create({
        model: SONNET_MODEL,
        max_tokens: 16000,
        system: developerMessage,
        messages: [{ role: 'user', content: userMessage }],
      }, abortSignal ? { signal: abortSignal } : undefined);

      const durationMs = Date.now() - t0;

      // Extract text
      const textBlock = response.content.find((c: any) => c.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        console.warn(`[Batched Sonnet] ${label} attempt ${attempt}: no text in response`);
        if (attempt === 1) continue;
        return { evidence: null, durationMs, tokenUsage: {} };
      }

      const rawText = textBlock.text;
      const evidence = parseCumulativeEvidenceFromOutput(rawText);

      if (!evidence) {
        console.warn(`[Batched Sonnet] ${label} attempt ${attempt}: failed to parse JSON (${rawText.length} chars)`);
        // Debug save raw response for inspection
        try {
          writeFileSync(`/tmp/prospectai-outputs/DEBUG-sonnet-${label.replace(/[^a-zA-Z0-9]/g, '-')}-raw-attempt${attempt}.txt`, rawText);
        } catch { /* ignore */ }
        if (attempt === 1) continue;
        return { evidence: null, durationMs, tokenUsage: {} };
      }

      const tokenUsage = {
        inputTokens: response.usage?.input_tokens || 0,
        outputTokens: response.usage?.output_tokens || 0,
        reasoningTokens: 0,
      };

      console.log(`[Batched Sonnet] ${label}: parsed ${evidence.sources_processed.length} sources, ${evidence.cross_source_patterns.length} patterns (${(durationMs / 1000).toFixed(1)}s)`);

      return { evidence, durationMs, tokenUsage };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg === 'Pipeline aborted by client') throw err;

      console.error(`[Batched Sonnet] ${label} attempt ${attempt} failed: ${errMsg}`);
      if (attempt === 2) {
        console.error(`[Batched Sonnet] ${label} failed after 2 attempts — skipping`);
        return { evidence: null, durationMs: Date.now() - t0, tokenUsage: {} };
      }
    }
  }

  return { evidence: null, durationMs: 0, tokenUsage: {} };
}

// ── Run a DR batch with timeout/retry (gap-fill only) ─────────────

async function runBatchWithRetry(
  label: string,
  developerMessage: string,
  userMessage: string,
  enableWebSearch: boolean,
  onProgress?: ProgressCallback,
  abortSignal?: AbortSignal,
  onActivity?: ActivityCallback,
): Promise<{ evidence: CumulativeEvidence | null; citations: DeepResearchCitation[]; searchCount: number; tokenUsage: any; durationMs: number }> {

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');

    console.log(`[Batched DR] ${label} attempt ${attempt}`);

    try {
      const result = await executeDeepResearch(
        label,
        developerMessage,
        userMessage,
        onProgress,
        abortSignal,
        onActivity,
        enableWebSearch ? 20 : 1,
      );

      const evidence = parseCumulativeEvidenceFromOutput(result.dossier);
      if (!evidence) {
        console.warn(`[Batched DR] ${label} attempt ${attempt}: failed to parse JSON from output (${result.dossier.length} chars)`);
        if (attempt === 1) {
          console.log(`[Batched DR] Retrying ${label}...`);
          continue;
        }
        // Second attempt also failed to parse — return null, batch will be skipped
        return {
          evidence: null,
          citations: result.citations,
          searchCount: result.searchCount,
          tokenUsage: result.tokenUsage,
          durationMs: result.durationMs,
        };
      }

      console.log(`[Batched DR] ${label}: parsed ${evidence.sources_processed.length} sources, ${evidence.cross_source_patterns.length} patterns`);

      return {
        evidence,
        citations: result.citations,
        searchCount: result.searchCount,
        tokenUsage: result.tokenUsage,
        durationMs: result.durationMs,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg === 'Pipeline aborted by client') throw err;

      console.error(`[Batched DR] ${label} attempt ${attempt} failed: ${errMsg}`);
      if (attempt === 2) {
        console.error(`[Batched DR] ${label} failed after 2 attempts — skipping`);
        return {
          evidence: null,
          citations: [],
          searchCount: 0,
          tokenUsage: {},
          durationMs: 0,
        };
      }
    }
  }

  // Unreachable, but TypeScript needs it
  return { evidence: null, citations: [], searchCount: 0, tokenUsage: {}, durationMs: 0 };
}

// ── Main entry point ──────────────────────────────────────────────

export async function runBatchedDeepResearch(
  donorName: string,
  linkedinData: LinkedInData | null,
  rankedSources: ScoredSource[],
  coverageGaps: CoverageGap[],
  onProgress?: ProgressCallback,
  abortSignal?: AbortSignal,
  onActivity?: ActivityCallback,
): Promise<DeepResearchResult> {
  const emit = onProgress || (() => {});
  const startTime = Date.now();

  // Build LinkedIn JSON
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

  // Ensure debug output dir exists
  try { mkdirSync('/tmp/prospectai-outputs', { recursive: true }); } catch { /* ignore */ }

  // Pack sources into batches
  const batches = packBatches(rankedSources);
  const totalSourcesInBatches = batches.reduce((sum, b) => sum + b.sources.length, 0);
  const droppedSources = rankedSources.length - totalSourcesInBatches;

  console.log(`[Batched] ${batches.length} source batches (Sonnet) from ${rankedSources.length} ranked sources (${droppedSources} dropped)`);
  for (const b of batches) {
    console.log(`[Batched]   Batch ${b.batchNumber}: ${b.sources.length} sources, ~${Math.round(b.totalChars / 1000)}K chars`);
  }

  let accumulated = createEmptyScaffold();
  let allCitations: DeepResearchCitation[] = [];
  let totalSearchCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalReasoningTokens = 0;

  // Build initial coverage gap report from Stage 5
  const initialCoverageGapReport = formatCoverageGapReport(coverageGaps);

  // ── Source batches ──────────────────────────────────────────────

  for (let i = 0; i < batches.length; i++) {
    if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');

    const batch = batches[i];
    const batchLabel = `Batch ${batch.batchNumber}/${batches.length}`;

    emit(
      `${batchLabel}: Extracting evidence from ${batch.sources.length} sources (~${Math.round(batch.totalChars / 1000)}K chars)`,
      'research',
      16 + i * 2,
      38,
    );

    let developerMessage: string;
    let userMessage: string;

    if (i === 0) {
      // Batch 1: fresh extraction
      developerMessage = buildBatch1DeveloperMessage(
        donorName,
        batch.sources.length,
        initialCoverageGapReport,
        linkedinJson,
      );
      userMessage = formatBatchSources(batch);
    } else {
      // Batch 2+: accumulated context
      const coverageMap = buildCoverageMap(accumulated);
      const coverageMapText = formatCoverageMapForBatch(coverageMap);

      developerMessage = buildBatchNDeveloperMessage(
        donorName,
        batch.batchNumber,
        batch.sources.length,
        coverageMapText,
        linkedinJson,
      );

      userMessage = `ACCUMULATED EVIDENCE FROM PRIOR BATCHES:\n${formatEvidenceForNextBatch(accumulated)}\n\n---\n\nNEW SOURCES FOR THIS BATCH:\n${formatBatchSources(batch)}`;
    }

    // Debug save
    try {
      writeFileSync(`/tmp/prospectai-outputs/DEBUG-batch-${batch.batchNumber}-developer-msg.txt`, developerMessage);
      writeFileSync(`/tmp/prospectai-outputs/DEBUG-batch-${batch.batchNumber}-user-msg.txt`, userMessage);
    } catch { /* ignore */ }

    const result = await executeSourceBatchWithSonnet(
      `${donorName} ${batchLabel}`,
      developerMessage,
      userMessage,
      onProgress,
      abortSignal,
      onActivity,
    );

    if (result.evidence) {
      accumulated = mergeEvidence(accumulated, result.evidence);
      console.log(`[Batched Sonnet] ${batchLabel}: merged. Total quotes: ${countTotalQuotes(accumulated)}, patterns: ${accumulated.cross_source_patterns.length}`);
    } else {
      console.warn(`[Batched Sonnet] ${batchLabel}: no parseable output — skipped`);
    }

    // Source batches via Sonnet don't produce citations or search counts
    totalInputTokens += result.tokenUsage?.inputTokens || 0;
    totalOutputTokens += result.tokenUsage?.outputTokens || 0;

    // Debug save accumulated evidence after each batch
    try {
      writeFileSync(
        `/tmp/prospectai-outputs/DEBUG-batch-${batch.batchNumber}-evidence.json`,
        JSON.stringify(accumulated, null, 2),
      );
    } catch { /* ignore */ }

    emit(
      `${batchLabel} complete. ${countTotalQuotes(accumulated)} quotes across ${countCoveredDimensions(accumulated)} dimensions`,
      'research',
      17 + i * 2,
      38,
    );
  }

  // ── Gap-fill batch ─────────────────────────────────────────────

  if (abortSignal?.aborted) throw new Error('Pipeline aborted by client');

  const coverageMap = buildCoverageMap(accumulated);
  const coverageMapText = formatCoverageMapForBatch(coverageMap);

  // Only run gap-fill if there are actual gaps
  const hasGaps = Object.values(coverageMap).some(
    e => e.status === 'ZERO_COVERAGE' || e.status === 'CRITICAL_GAP'
  );

  if (hasGaps) {
    emit(
      `Gap-fill: searching web for ${Object.values(coverageMap).filter(e => e.status !== 'SUFFICIENT').length} underserved dimensions`,
      'research',
      16 + batches.length * 2,
      38,
    );

    const gapFillDeveloperMessage = buildGapFillDeveloperMessage(
      donorName,
      coverageMapText,
      linkedinJson,
    );

    const gapFillUserMessage = `ACCUMULATED EVIDENCE:\n${formatEvidenceForNextBatch(accumulated)}`;

    try {
      writeFileSync('/tmp/prospectai-outputs/DEBUG-batch-gapfill-developer-msg.txt', gapFillDeveloperMessage);
      writeFileSync('/tmp/prospectai-outputs/DEBUG-batch-gapfill-user-msg.txt', gapFillUserMessage);
    } catch { /* ignore */ }

    const gapResult = await runBatchWithRetry(
      `${donorName} Gap-fill`,
      gapFillDeveloperMessage,
      gapFillUserMessage,
      true, // web search enabled for gap-fill
      onProgress,
      abortSignal,
      onActivity,
    );

    if (gapResult.evidence) {
      accumulated = mergeEvidence(accumulated, gapResult.evidence);
      console.log(`[Batched DR] Gap-fill: merged. Total quotes: ${countTotalQuotes(accumulated)}`);
    } else {
      console.warn(`[Batched DR] Gap-fill: no parseable output — skipped`);
    }

    allCitations.push(...gapResult.citations);
    totalSearchCount += gapResult.searchCount;
    totalInputTokens += gapResult.tokenUsage?.inputTokens || 0;
    totalOutputTokens += gapResult.tokenUsage?.outputTokens || 0;
    totalReasoningTokens += gapResult.tokenUsage?.reasoningTokens || 0;

    try {
      writeFileSync(
        '/tmp/prospectai-outputs/DEBUG-batch-gapfill-evidence.json',
        JSON.stringify(accumulated, null, 2),
      );
    } catch { /* ignore */ }
  } else {
    console.log('[Batched DR] All dimensions at SUFFICIENT or better — skipping gap-fill');
  }

  // ── Convert to dossier text ────────────────────────────────────

  const dossier = formatEvidenceAsDossier(accumulated);
  const durationMs = Date.now() - startTime;
  const durationMin = (durationMs / 60000).toFixed(1);

  // Debug save final
  try {
    writeFileSync('/tmp/prospectai-outputs/DEBUG-research-package.txt', dossier);
    writeFileSync('/tmp/prospectai-outputs/DEBUG-final-accumulated-evidence.json', JSON.stringify(accumulated, null, 2));
    writeFileSync('/tmp/prospectai-outputs/DEBUG-batched-dr-stats.json', JSON.stringify({
      batches: batches.length,
      gapFillRan: hasGaps,
      totalSources: totalSourcesInBatches,
      droppedSources,
      totalQuotes: countTotalQuotes(accumulated),
      coveredDimensions: countCoveredDimensions(accumulated),
      totalSearchCount,
      totalInputTokens,
      totalOutputTokens,
      totalReasoningTokens,
      durationMs,
      durationMin: parseFloat(durationMin),
      dossierLength: dossier.length,
    }, null, 2));
  } catch { /* ignore */ }

  console.log(`[Batched] Complete: ${batches.length} Sonnet batches + ${hasGaps ? '1 DR' : '0'} gap-fill, ${countTotalQuotes(accumulated)} quotes, ${dossier.length} chars, ${durationMin} min`);

  emit(
    `Research complete: ${batches.length} extraction batches + ${hasGaps ? '1' : '0'} gap-fill, ${totalSearchCount} searches, ${Math.round(dossier.length / 4)} tokens, ${durationMin} min`,
    'research',
    22,
    38,
  );

  // Determine evidence density
  let evidenceDensity: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';
  const totalQuotes = countTotalQuotes(accumulated);
  if (totalQuotes >= 80) evidenceDensity = 'HIGH';
  else if (totalQuotes < 30) evidenceDensity = 'LOW';

  return {
    dossier,
    citations: allCitations,
    searchCount: totalSearchCount,
    tokenUsage: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      reasoningTokens: totalReasoningTokens,
    },
    durationMs,
    researchStrategy: 'v5-sonnet-extract-dr-gapfill',
    evidenceDensity,
  };
}

// ── Helpers ───────────────────────────────────────────────────────

function countTotalQuotes(evidence: CumulativeEvidence): number {
  let total = 0;
  for (const key of ALL_DIM_KEYS) {
    total += evidence.dimensions[key]?.quotes.length || 0;
  }
  return total;
}

function countCoveredDimensions(evidence: CumulativeEvidence): number {
  let count = 0;
  for (const key of ALL_DIM_KEYS) {
    if ((evidence.dimensions[key]?.quotes.length || 0) > 0) count++;
  }
  return count;
}
