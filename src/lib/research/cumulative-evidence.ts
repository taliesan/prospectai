// Cumulative Evidence — the structured format that carries evidence between
// batched Deep Research calls and ultimately converts to the dossier text
// that Opus receives for profile generation.
//
// Flow:
//   createEmptyScaffold() → batch 1 output (JSON) → mergeEvidence()
//     → batch 2 output (JSON) → mergeEvidence() → ... → formatEvidenceAsDossier()

import {
  DIMENSIONS,
  dimKey,
  type DimensionDef,
} from '../dimensions';
import { INVESTMENT_TARGETS } from '../prompts/source-scoring';

// ── Types ─────────────────────────────────────────────────────────

export type EvidenceStrength = 'ZERO' | 'THIN' | 'MODERATE' | 'STRONG';

export interface EvidenceQuote {
  text: string;
  source_url: string;
  depth: 1 | 2 | 3;
}

export interface DimensionEvidence {
  quotes: EvidenceQuote[];
  analysis: string;
  coverage_count: number;
  strength: EvidenceStrength;
}

export interface CumulativeEvidence {
  dimensions: Record<string, DimensionEvidence>;
  cross_source_patterns: string[];
  contradictions: string[];
  sources_processed: string[];
}

// ── Dimension key format: "1_DECISION_MAKING" ─────────────────────

const DIM_KEYS_BY_ID: Record<number, string> = {};
const DIM_DEFS_BY_KEY: Record<string, DimensionDef> = {};
for (const d of DIMENSIONS) {
  const k = dimKey(d);
  DIM_KEYS_BY_ID[d.id] = k;
  DIM_DEFS_BY_KEY[k] = d;
}

/** All 25 dimension keys in canonical order: "1_DECISION_MAKING" through "25_CONDITIONAL_BEHAVIORAL_FORKS" */
export const ALL_DIM_KEYS: string[] = DIMENSIONS.map(d => dimKey(d));

// ── Scaffold ──────────────────────────────────────────────────────

export function createEmptyScaffold(): CumulativeEvidence {
  const dimensions: Record<string, DimensionEvidence> = {};
  for (const key of ALL_DIM_KEYS) {
    dimensions[key] = {
      quotes: [],
      analysis: '',
      coverage_count: 0,
      strength: 'ZERO',
    };
  }
  return {
    dimensions,
    cross_source_patterns: [],
    contradictions: [],
    sources_processed: [],
  };
}

// ── Strength calculation ──────────────────────────────────────────

function computeStrength(quoteCount: number, dim: DimensionDef): EvidenceStrength {
  if (quoteCount === 0) return 'ZERO';
  const target = INVESTMENT_TARGETS[dim.id] || 2;
  if (quoteCount < target * 0.5) return 'THIN';
  if (quoteCount < target) return 'MODERATE';
  return 'STRONG';
}

// ── Text similarity helper ────────────────────────────────────────

/** Compute word-level Jaccard similarity between two strings (0–1). */
function textSimilarity(a: string, b: string): number {
  const arrA = a.toLowerCase().split(/\s+/).filter(Boolean);
  const arrB = b.toLowerCase().split(/\s+/).filter(Boolean);
  if (arrA.length === 0 && arrB.length === 0) return 1;
  if (arrA.length === 0 || arrB.length === 0) return 0;
  const setB = new Set(arrB);
  let intersection = 0;
  const setA = new Set(arrA);
  for (let i = 0; i < arrA.length; i++) {
    if (setB.has(arrA[i])) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

// ── Merge a batch result into accumulated evidence ────────────────

export function mergeEvidence(
  accumulated: CumulativeEvidence,
  batchResult: CumulativeEvidence,
): CumulativeEvidence {
  const merged = structuredClone(accumulated);

  for (const key of ALL_DIM_KEYS) {
    const acc = merged.dimensions[key];
    const batch = batchResult.dimensions[key];
    if (!batch) continue;

    // Append new quotes, deduplicating by source_url + text prefix AND by >90% text overlap
    const existingFingerprints = new Set(
      acc.quotes.map(q => `${q.source_url}|||${q.text.slice(0, 80)}`)
    );
    for (const q of batch.quotes) {
      const fp = `${q.source_url}|||${q.text.slice(0, 80)}`;
      if (existingFingerprints.has(fp)) continue;

      // Check for >90% text overlap with any existing quote in this dimension
      const isDuplicate = acc.quotes.some(
        existing => textSimilarity(existing.text, q.text) > 0.9
      );
      if (isDuplicate) continue;

      acc.quotes.push(q);
      existingFingerprints.add(fp);
    }

    // Extend analysis — deduplicate paragraphs with >80% text overlap
    if (batch.analysis) {
      if (!acc.analysis) {
        acc.analysis = batch.analysis;
      } else {
        const existingParagraphs = acc.analysis.split(/\n\n+/).filter(Boolean);
        const newParagraphs = batch.analysis.split(/\n\n+/).filter(Boolean);
        const genuinelyNew: string[] = [];

        for (const newPara of newParagraphs) {
          const isDup = existingParagraphs.some(
            existing => textSimilarity(existing, newPara) > 0.8
          );
          if (!isDup) genuinelyNew.push(newPara);
        }

        if (genuinelyNew.length > 0) {
          acc.analysis = `${acc.analysis}\n\n${genuinelyNew.join('\n\n')}`;
        }
      }
    }

    // Recalculate coverage and strength from merged quotes
    acc.coverage_count = acc.quotes.length;
    const dim = DIM_DEFS_BY_KEY[key];
    if (dim) {
      acc.strength = computeStrength(acc.coverage_count, dim);
    }
  }

  // Merge cross-source patterns (deduplicate by prefix)
  const existingPatterns = new Set(
    merged.cross_source_patterns.map(p => p.slice(0, 60))
  );
  for (const p of batchResult.cross_source_patterns) {
    if (!existingPatterns.has(p.slice(0, 60))) {
      merged.cross_source_patterns.push(p);
      existingPatterns.add(p.slice(0, 60));
    }
  }

  // Merge contradictions
  const existingContradictions = new Set(
    merged.contradictions.map(c => c.slice(0, 60))
  );
  for (const c of batchResult.contradictions) {
    if (!existingContradictions.has(c.slice(0, 60))) {
      merged.contradictions.push(c);
      existingContradictions.add(c.slice(0, 60));
    }
  }

  // Merge sources processed
  const processedSet = new Set(merged.sources_processed);
  for (const s of batchResult.sources_processed) {
    if (!processedSet.has(s)) {
      merged.sources_processed.push(s);
      processedSet.add(s);
    }
  }

  return merged;
}

// ── Coverage map (same status logic as source-scoring.ts:446-449) ─

export type CoverageStatus = 'SUFFICIENT' | 'GAP' | 'CRITICAL_GAP' | 'ZERO_COVERAGE';

export interface CoverageMapEntry {
  coverage_count: number;
  target: number;
  status: CoverageStatus;
  strength: EvidenceStrength;
}

export function buildCoverageMap(
  evidence: CumulativeEvidence,
): Record<string, CoverageMapEntry> {
  const map: Record<string, CoverageMapEntry> = {};

  for (const d of DIMENSIONS) {
    const key = dimKey(d);
    const dimEv = evidence.dimensions[key];
    const count = dimEv?.coverage_count || 0;
    const target = INVESTMENT_TARGETS[d.id] || 2;

    let status: CoverageStatus;
    if (count === 0) status = 'ZERO_COVERAGE';
    else if (count < target * 0.5) status = 'CRITICAL_GAP';
    else if (count < target) status = 'GAP';
    else status = 'SUFFICIENT';

    map[key] = {
      coverage_count: count,
      target,
      status,
      strength: dimEv?.strength || 'ZERO',
    };
  }

  return map;
}

// ── Format coverage map as text for DR developer messages ─────────

export function formatCoverageMapForBatch(
  coverageMap: Record<string, CoverageMapEntry>,
): string {
  const lines: string[] = [
    'CURRENT COVERAGE STATUS:',
    '',
  ];

  // Sort: ZERO_COVERAGE first, then CRITICAL_GAP, GAP, SUFFICIENT
  const priority: Record<string, number> = {
    ZERO_COVERAGE: 0, CRITICAL_GAP: 1, GAP: 2, SUFFICIENT: 3,
  };

  const entries = Object.entries(coverageMap)
    .sort(([, a], [, b]) => (priority[a.status] ?? 4) - (priority[b.status] ?? 4));

  for (const [key, entry] of entries) {
    const marker = entry.status === 'SUFFICIENT' ? '' : ` *** ${entry.status} ***`;
    lines.push(
      `${key}: ${entry.coverage_count} quotes (target: ${entry.target}, strength: ${entry.strength})${marker}`
    );
  }

  return lines.join('\n');
}

// ── Format accumulated evidence JSON string for next batch ────────

export function formatEvidenceForNextBatch(evidence: CumulativeEvidence): string {
  return JSON.stringify(evidence, null, 2);
}

// ── Format as dossier text (what Opus receives) ───────────────────
//
// Produces the same structure that the monolithic Deep Research call
// produced: dimension headings → QUOTES block → ANALYSIS block,
// followed by CROSS-SOURCE PATTERN and CONTRADICTION flags.
//
// buildProfilePrompt wraps this in "# BEHAVIORAL EVIDENCE" — we just
// produce the inner content.

export function formatEvidenceAsDossier(evidence: CumulativeEvidence): string {
  const sections: string[] = [];

  for (const d of DIMENSIONS) {
    const key = dimKey(d);
    const dimEv = evidence.dimensions[key];

    sections.push(`## ${d.id}. ${d.key} — ${d.label}`);
    sections.push(`Investment Tier: ${d.tier} | Evidence Strength: ${dimEv?.strength || 'ZERO'}`);
    sections.push('');

    if (!dimEv || dimEv.quotes.length === 0) {
      sections.push('No usable behavioral evidence found.');
      sections.push('');
      continue;
    }

    // QUOTES block
    sections.push('QUOTES:');
    for (const q of dimEv.quotes) {
      const depthLabel = q.depth === 3 ? 'Rich' : q.depth === 2 ? 'Passage' : 'Mention';
      sections.push(`[${depthLabel} | ${q.source_url}]`);
      sections.push(q.text);
      sections.push('');
    }

    // ANALYSIS block — strip no-op filler lines before outputting
    if (dimEv.analysis) {
      const cleaned = dimEv.analysis
        .split('\n')
        .filter(line => !/no new evidence|no additional evidence|no usable evidence|no relevant evidence/i.test(line.trim()))
        .join('\n')
        .trim();
      if (cleaned) {
        sections.push('ANALYSIS:');
        sections.push(cleaned);
        sections.push('');
      }
    }

    sections.push('');
  }

  // Cross-source patterns
  if (evidence.cross_source_patterns.length > 0) {
    sections.push('---');
    sections.push('## CROSS-SOURCE PATTERNS');
    sections.push('');
    for (const p of evidence.cross_source_patterns) {
      sections.push(`CROSS-SOURCE PATTERN: ${p}`);
      sections.push('');
    }
  }

  // Contradictions
  if (evidence.contradictions.length > 0) {
    sections.push('---');
    sections.push('## CONTRADICTIONS');
    sections.push('');
    for (const c of evidence.contradictions) {
      sections.push(`CONTRADICTION: ${c}`);
      sections.push('');
    }
  }

  // Sources processed
  if (evidence.sources_processed.length > 0) {
    sections.push('---');
    sections.push(`Sources processed: ${evidence.sources_processed.length}`);
    for (const url of evidence.sources_processed) {
      sections.push(`- ${url}`);
    }
  }

  return sections.join('\n');
}

// ── JSON Schema description for DR prompts ────────────────────────
// Included in developer messages so the model knows the exact output format.

export const CUMULATIVE_EVIDENCE_SCHEMA = `{
  "dimensions": {
    "1_DECISION_MAKING": {
      "quotes": [
        { "text": "Exact quote or passage (50-300 words)", "source_url": "https://...", "depth": 3 }
      ],
      "analysis": "Your CROSS-SOURCE PATTERN, CONTRADICTION, and CONDITIONAL flags for this dimension. Write in behavioral register: what the person does, when they do it, what it looks like, what someone across the table should do about it.",
      "coverage_count": 3,
      "strength": "MODERATE"
    },
    // ... all 25 dimensions, keyed as "{id}_{KEY}" (e.g. "2_TRUST_CALIBRATION", "15_COMMITMENT_PATTERNS")
  },
  "cross_source_patterns": [
    "Pattern description citing multiple sources"
  ],
  "contradictions": [
    "Description of contradiction between stated and observed behavior, with source citations"
  ],
  "sources_processed": [
    "https://source1.com/article",
    "https://source2.com/interview"
  ]
}

DIMENSION KEYS (use these exact strings):
${ALL_DIM_KEYS.join(', ')}

STRENGTH VALUES — compute from quote count:
- "ZERO": 0 quotes
- "THIN": below 50% of target for this dimension's tier
- "MODERATE": 50-99% of target
- "STRONG": at or above target

TARGETS: HIGH tier (1-7) = 7, MEDIUM tier (8-15) = 5, LOW tier (16-25) = 2

DEPTH SCALE for each quote:
  1 = Mention — a fact without behavioral detail
  2 = Passage — a paragraph describing a decision/action with context
  3 = Rich evidence — direct quotes showing how they think, behavior under pressure`;
