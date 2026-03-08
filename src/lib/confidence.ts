// Per-section confidence scoring — structural floor computation
//
// Computes a deterministic confidence floor (1-10) for each of the 7 profile
// sections based on evidence density, depth, and attribution quality from
// the Stage 5b selection output.

import { INVESTMENT_TARGETS, type DimensionAttribution, type CoverageGap } from './prompts/source-scoring';

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

export interface SectionConfidence {
  section: number;          // 1-7
  sectionName: string;
  floor: number;            // 1-10
  dimensionDetails: {
    dimId: number;
    dimName: string;
    isPrimary: boolean;
    dimConfidence: number;  // 0-10
    coverageStatus: string; // SUFFICIENT / GAP / CRITICAL_GAP / ZERO_COVERAGE
    maxDepth: number;
    bestAttribution: string;
  }[];
}

export interface ConfidenceResult {
  sections: SectionConfidence[];
  /** Pre-formatted block for injection into the profile prompt */
  promptBlock: string;
}

// ══════════════════════════════════════════════════════════════════════
// SECTION → DIMENSION MAPPING
// ══════════════════════════════════════════════════════════════════════

interface DimensionMapping {
  dimId: number;
  isPrimary: boolean;
}

interface SectionMapping {
  section: number;
  name: string;
  dimensions: DimensionMapping[];
}

const SECTION_DIMENSION_MAP: SectionMapping[] = [
  {
    section: 1,
    name: 'The Operating System',
    dimensions: [
      { dimId: 4, isPrimary: true },   // IDENTITY_SELF_CONCEPT
      { dimId: 7, isPrimary: true },   // POWER_ANALYSIS
      { dimId: 5, isPrimary: false },  // VALUES_HIERARCHY
      { dimId: 1, isPrimary: false },  // DECISION_MAKING
    ],
  },
  {
    section: 2,
    name: 'The Contradiction',
    dimensions: [
      { dimId: 6, isPrimary: true },   // CONTRADICTION_PATTERNS
      { dimId: 5, isPrimary: false },  // VALUES_HIERARCHY
      { dimId: 7, isPrimary: false },  // POWER_ANALYSIS
    ],
  },
  {
    section: 3,
    name: 'What Drives Them',
    dimensions: [
      { dimId: 5, isPrimary: true },   // VALUES_HIERARCHY
      { dimId: 14, isPrimary: true },  // RESOURCE_PHILOSOPHY
      { dimId: 11, isPrimary: false }, // EMOTIONAL_TRIGGERS
      { dimId: 15, isPrimary: false }, // COMMITMENT_PATTERNS
    ],
  },
  {
    section: 4,
    name: 'How to Read Them in Real Time',
    dimensions: [
      { dimId: 21, isPrimary: true },  // REAL_TIME_INTERPERSONAL_TELLS
      { dimId: 3, isPrimary: true },   // COMMUNICATION_STYLE
      { dimId: 22, isPrimary: true },  // TEMPO_MANAGEMENT
      { dimId: 11, isPrimary: false }, // EMOTIONAL_TRIGGERS
      { dimId: 1, isPrimary: false },  // DECISION_MAKING
      { dimId: 2, isPrimary: false },  // TRUST_CALIBRATION
    ],
  },
  {
    section: 5,
    name: 'What Shuts Them Down',
    dimensions: [
      { dimId: 20, isPrimary: true },  // SHAME_DEFENSE_TRIGGERS
      { dimId: 19, isPrimary: true },  // RETREAT_PATTERNS
      { dimId: 10, isPrimary: true },  // BOUNDARY_CONDITIONS
      { dimId: 24, isPrimary: true },  // RECOVERY_PATHS
      { dimId: 11, isPrimary: false }, // EMOTIONAL_TRIGGERS
      { dimId: 2, isPrimary: false },  // TRUST_CALIBRATION
    ],
  },
  {
    section: 6,
    name: 'Interest → Committed',
    dimensions: [
      { dimId: 2, isPrimary: true },   // TRUST_CALIBRATION
      { dimId: 15, isPrimary: true },  // COMMITMENT_PATTERNS
      { dimId: 1, isPrimary: true },   // DECISION_MAKING
      { dimId: 12, isPrimary: false }, // RELATIONSHIP_PATTERNS
      { dimId: 9, isPrimary: false },  // TIME_ORIENTATION
      { dimId: 14, isPrimary: false }, // RESOURCE_PHILOSOPHY
    ],
  },
  {
    section: 7,
    name: 'The Dinner Party Test',
    dimensions: [
      { dimId: 11, isPrimary: true },  // EMOTIONAL_TRIGGERS
      { dimId: 12, isPrimary: true },  // RELATIONSHIP_PATTERNS
      { dimId: 18, isPrimary: true },  // KNOWLEDGE_AREAS
      { dimId: 17, isPrimary: false }, // STATUS_RECOGNITION
      { dimId: 3, isPrimary: false },  // COMMUNICATION_STYLE
      { dimId: 16, isPrimary: false }, // LEARNING_STYLE
    ],
  },
];

// ══════════════════════════════════════════════════════════════════════
// DIMENSION NAMES (copied from source-scoring.ts for self-containment)
// ══════════════════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════════════════
// COMPUTATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Compute per-dimension confidence score (0-10).
 *
 * dim_conf = min(10, coverage_score + depth_score + attribution_score)
 *   coverage_score = min(5, (depth2plus_count / target) × 5)
 *   depth_score    = max_depth (0-3)
 *   attribution_score = 2 if target_authored, 1 if target_coverage, 0 otherwise
 */
function computeDimensionConfidence(
  dimId: number,
  attr: DimensionAttribution,
): number {
  const target = INVESTMENT_TARGETS[dimId] || 2;

  const coverageScore = Math.min(5, (attr.depth2plus_count / target) * 5);
  const depthScore = attr.max_depth;

  let attributionScore = 0;
  if (attr.best_attribution === 'target_authored') attributionScore = 2;
  else if (attr.best_attribution === 'target_coverage') attributionScore = 1;

  return Math.min(10, coverageScore + depthScore + attributionScore);
}

/**
 * Compute structural confidence floors for all 7 profile sections.
 *
 * Takes Stage 5b output (dimension_attribution + coverageGaps) and returns
 * per-section confidence floors plus a formatted prompt block.
 */
export function computeSectionConfidence(
  dimensionAttribution: Record<number, DimensionAttribution>,
  coverageGaps: CoverageGap[],
): ConfidenceResult {
  // Build lookup for coverage status
  const gapStatus: Record<number, string> = {};
  for (const g of coverageGaps) {
    gapStatus[g.dimId] = g.status;
  }

  const sections: SectionConfidence[] = [];

  for (const mapping of SECTION_DIMENSION_MAP) {
    let weightedSum = 0;
    let totalWeight = 0;
    const dimensionDetails: SectionConfidence['dimensionDetails'] = [];

    for (const dim of mapping.dimensions) {
      const attr = dimensionAttribution[dim.dimId] || {
        depth2plus_count: 0,
        max_depth: 0,
        best_attribution: null,
      };

      const dimConf = computeDimensionConfidence(dim.dimId, attr);
      const weight = dim.isPrimary ? 2 : 1;

      weightedSum += dimConf * weight;
      totalWeight += weight;

      dimensionDetails.push({
        dimId: dim.dimId,
        dimName: DIMENSION_NAMES[dim.dimId] || `DIM_${dim.dimId}`,
        isPrimary: dim.isPrimary,
        dimConfidence: Math.round(dimConf * 10) / 10,
        coverageStatus: gapStatus[dim.dimId] || 'UNKNOWN',
        maxDepth: attr.max_depth,
        bestAttribution: attr.best_attribution || 'none',
      });
    }

    const floor = Math.max(1, Math.round(weightedSum / totalWeight));

    sections.push({
      section: mapping.section,
      sectionName: mapping.name,
      floor,
      dimensionDetails,
    });
  }

  // Build prompt block
  const promptBlock = buildConfidencePromptBlock(sections);

  return { sections, promptBlock };
}

// ══════════════════════════════════════════════════════════════════════
// PROMPT BLOCK BUILDER
// ══════════════════════════════════════════════════════════════════════

function buildConfidencePromptBlock(sections: SectionConfidence[]): string {
  const floorLines = sections.map(s =>
    `  ${s.section}. ${s.sectionName}: ${s.floor}/10`
  ).join('\n');

  return `
CONFIDENCE SCORING

You have been provided structural confidence floors for each section. These are computed from the evidence density and quality in the research package. For each section you write, output a confidence metadata block immediately after the section header:

[CONFIDENCE: {score}/10 | FLOOR: {structural_floor}]
[EVIDENCE BASIS: {which dimensions and source types you drew on}]
[INFERRED: {what in this section you had to infer, and from what}]
[EVIDENCE CEILINGS: {any ceiling markers from the research package that limit this section}]

Scoring guide:
  9-10: Multiple independent sources with direct quotes or observable behavior
  7-8:  Strong evidence, 1-2 inferences clearly marked
  5-6:  Mixed — some claims sourced, some inferred from patterns
  3-4:  Thin evidence, section is substantially inferential
  1-2:  Speculation from minimal data

You MUST justify any score that differs from the structural floor by more than ±2 points. Do not inflate. A section built on one institutional inference and a gap-fill essay is a 4, not a 7.

Structural floors:
${floorLines}
`;
}

// ══════════════════════════════════════════════════════════════════════
// CONFIDENCE AUDIT BLOCK (for editorial/fact-check pass)
// ══════════════════════════════════════════════════════════════════════

export function buildConfidenceAuditBlock(): string {
  return `
CONFIDENCE AUDIT

For each section, check whether the confidence score matches the evidence density in that section:

- INFLATED: Score >= 7 but section relies on fewer than 3 independently sourced claims
- DEFLATED: Score <= 4 but section contains 5+ directly sourced claims with quotes
- CEILING_IGNORED: Section makes claims beyond evidence ceiling markers without flagging them as inference
- CALIBRATED: Score reasonably matches evidence density

Output a per-section confidence audit after the redrafted profile, in this exact format:

[CONFIDENCE AUDIT]
Section 1: {CALIBRATED|INFLATED|DEFLATED|CEILING_IGNORED} — {one-line justification}
Section 2: {CALIBRATED|INFLATED|DEFLATED|CEILING_IGNORED} — {one-line justification}
Section 3: {CALIBRATED|INFLATED|DEFLATED|CEILING_IGNORED} — {one-line justification}
Section 4: {CALIBRATED|INFLATED|DEFLATED|CEILING_IGNORED} — {one-line justification}
Section 5: {CALIBRATED|INFLATED|DEFLATED|CEILING_IGNORED} — {one-line justification}
Section 6: {CALIBRATED|INFLATED|DEFLATED|CEILING_IGNORED} — {one-line justification}
Section 7: {CALIBRATED|INFLATED|DEFLATED|CEILING_IGNORED} — {one-line justification}

If any section is INFLATED or CEILING_IGNORED, the editorial pass MUST either lower the score or remove/qualify the unsupported claims.
`;
}

// ══════════════════════════════════════════════════════════════════════
// PARSERS — Extract confidence metadata from LLM output
// ══════════════════════════════════════════════════════════════════════

export interface ParsedSectionConfidence {
  section: number;
  score: number;
  floor: number;
  evidenceBasis: string;
  inferred: string;
  evidenceCeilings: string;
}

export interface ParsedConfidenceAudit {
  section: number;
  verdict: 'CALIBRATED' | 'INFLATED' | 'DEFLATED' | 'CEILING_IGNORED';
  justification: string;
}

/**
 * Parse [CONFIDENCE: ...] blocks from the Opus profile output.
 * Returns one entry per section found.
 */
export function parseConfidenceBlocks(profileText: string): ParsedSectionConfidence[] {
  const results: ParsedSectionConfidence[] = [];

  // Match section headers followed by confidence blocks
  // Pattern: "## N." or "### N." header, then [CONFIDENCE: X/10 | FLOOR: Y]
  const sectionPattern = /#{2,3}\s*(\d)\.\s*[^\n]*\n+\[CONFIDENCE:\s*(\d+)\/10\s*\|\s*FLOOR:\s*(\d+)\]/g;
  let match;

  while ((match = sectionPattern.exec(profileText)) !== null) {
    const sectionNum = parseInt(match[1], 10);
    const score = parseInt(match[2], 10);
    const floor = parseInt(match[3], 10);

    // Find the evidence basis, inferred, and ceiling lines after this match
    const afterMatch = profileText.slice(match.index + match[0].length, match.index + match[0].length + 1000);

    const evidenceBasis = extractBracketedField(afterMatch, 'EVIDENCE BASIS');
    const inferred = extractBracketedField(afterMatch, 'INFERRED');
    const evidenceCeilings = extractBracketedField(afterMatch, 'EVIDENCE CEILINGS');

    results.push({
      section: sectionNum,
      score,
      floor,
      evidenceBasis,
      inferred,
      evidenceCeilings,
    });
  }

  return results;
}

/**
 * Parse [CONFIDENCE AUDIT] block from editorial pass output.
 */
export function parseConfidenceAudit(editorialText: string): ParsedConfidenceAudit[] {
  const results: ParsedConfidenceAudit[] = [];

  const auditPattern = /Section\s*(\d):\s*(CALIBRATED|INFLATED|DEFLATED|CEILING_IGNORED)\s*[—\-]\s*(.+)/g;
  let match;

  while ((match = auditPattern.exec(editorialText)) !== null) {
    results.push({
      section: parseInt(match[1], 10),
      verdict: match[2] as ParsedConfidenceAudit['verdict'],
      justification: match[3].trim(),
    });
  }

  return results;
}

/** Extract content from a [LABEL: content] line */
function extractBracketedField(text: string, label: string): string {
  const pattern = new RegExp(`\\[${label}:\\s*([^\\]]+)\\]`);
  const match = text.match(pattern);
  return match ? match[1].trim() : '';
}

// ══════════════════════════════════════════════════════════════════════
// RENDERER — Format confidence scores in final profile markdown
// ══════════════════════════════════════════════════════════════════════

/**
 * Inject rendered confidence scores into the final profile markdown.
 * Replaces [CONFIDENCE: ...] metadata blocks with the visual format:
 *
 *   ### 2. THE CONTRADICTION                           ■■■■■■■■□□  8/10
 *   > Evidence: 3 interviews, 2 press profiles, 990 records
 *   > Inferred: timing of values shift (pattern across 2018-2022)
 */
export function renderConfidenceInProfile(
  profileText: string,
  parsedConfidence: ParsedSectionConfidence[],
  auditResults?: ParsedConfidenceAudit[],
): string {
  let result = profileText;

  // Build audit lookup
  const auditBySection: Record<number, ParsedConfidenceAudit> = {};
  if (auditResults) {
    for (const a of auditResults) {
      auditBySection[a.section] = a;
    }
  }

  // Process each section in reverse order to preserve indices
  const sorted = [...parsedConfidence].sort((a, b) => b.section - a.section);

  for (const conf of sorted) {
    // Apply audit adjustment: if INFLATED, cap at floor+2; if DEFLATED, bump to floor-1
    let finalScore = conf.score;
    const audit = auditBySection[conf.section];
    if (audit) {
      if (audit.verdict === 'INFLATED' && finalScore > conf.floor + 2) {
        finalScore = conf.floor + 2;
      }
    }
    finalScore = Math.max(1, Math.min(10, finalScore));

    // Build the visual bar
    const filled = '■'.repeat(finalScore);
    const empty = '□'.repeat(10 - finalScore);
    const bar = `${filled}${empty}  ${finalScore}/10`;

    // Build evidence/inferred lines
    const metaLines: string[] = [];
    if (conf.evidenceBasis) {
      metaLines.push(`> Evidence: ${conf.evidenceBasis}`);
    }
    if (conf.inferred) {
      metaLines.push(`> Inferred: ${conf.inferred}`);
    }
    const metaBlock = metaLines.length > 0 ? '\n' + metaLines.join('\n') : '';

    // Find and replace the section header + confidence metadata block
    // Match: "## N. SECTION TITLE" or "### N. SECTION TITLE" followed by confidence lines
    const sectionHeaderPattern = new RegExp(
      `(#{2,3}\\s*${conf.section}\\.\\s*[^\\n]*)\\n+` +
      `\\[CONFIDENCE:[^\\]]*\\]\\s*\\n?` +
      `(?:\\[EVIDENCE BASIS:[^\\]]*\\]\\s*\\n?)?` +
      `(?:\\[INFERRED:[^\\]]*\\]\\s*\\n?)?` +
      `(?:\\[EVIDENCE CEILINGS:[^\\]]*\\]\\s*\\n?)?`,
    );

    result = result.replace(sectionHeaderPattern, (_, header) => {
      // Pad the header to align the bar at a consistent column
      const paddedHeader = header.padEnd(50);
      return `${paddedHeader} ${bar}${metaBlock}\n\n`;
    });
  }

  // Remove the [CONFIDENCE AUDIT] block from the output if present
  result = result.replace(/\[CONFIDENCE AUDIT\][\s\S]*?(?=\n#{1,3}\s|\n---|\s*$)/, '');

  return result;
}
