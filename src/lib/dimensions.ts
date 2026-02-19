// Canonical 25 Behavioral Dimensions — Single Source of Truth
//
// Every module that references behavioral dimensions imports from here.
// No other file should define dimension lists, names, or tiers.

export type InvestmentTier = 'HIGH' | 'MEDIUM' | 'LOW';

export interface DimensionDef {
  id: number;
  key: DimensionKey;
  label: string;
  description: string;
  tier: InvestmentTier;
  /** Target evidence entries: HIGH=6-8, MEDIUM=4-6, LOW=1-3 */
  targetMin: number;
  targetMax: number;
}

export const DIMENSION_KEYS = [
  // HIGH INVESTMENT (1-7)
  'DECISION_MAKING',
  'TRUST_CALIBRATION',
  'COMMUNICATION_STYLE',
  'IDENTITY_SELF_CONCEPT',
  'VALUES_HIERARCHY',
  'CONTRADICTION_PATTERNS',
  'POWER_ANALYSIS',
  // MEDIUM INVESTMENT (8-15)
  'INFLUENCE_SUSCEPTIBILITY',
  'TIME_ORIENTATION',
  'BOUNDARY_CONDITIONS',
  'EMOTIONAL_TRIGGERS',
  'RELATIONSHIP_PATTERNS',
  'RISK_TOLERANCE',
  'RESOURCE_PHILOSOPHY',
  'COMMITMENT_PATTERNS',
  // LOW INVESTMENT (16-25)
  'LEARNING_STYLE',
  'STATUS_RECOGNITION',
  'KNOWLEDGE_AREAS',
  'RETREAT_PATTERNS',
  'SHAME_DEFENSE_TRIGGERS',
  'REAL_TIME_INTERPERSONAL_TELLS',
  'TEMPO_MANAGEMENT',
  'HIDDEN_FRAGILITIES',
  'RECOVERY_PATHS',
  'CONDITIONAL_BEHAVIORAL_FORKS',
] as const;

export type DimensionKey = typeof DIMENSION_KEYS[number];

// ── Canonical dimension definitions ─────────────────────────────────

export const DIMENSIONS: DimensionDef[] = [
  // HIGH INVESTMENT (1-7)
  { id: 1,  key: 'DECISION_MAKING',              label: 'Decision Making',              description: 'How they evaluate proposals and opportunities. Speed of decisions, gut vs analysis, what triggers yes/no.',                                                                                                                                  tier: 'HIGH',   targetMin: 6, targetMax: 8 },
  { id: 2,  key: 'TRUST_CALIBRATION',             label: 'Trust Calibration',            description: 'What builds or breaks credibility. Verification behavior, skepticism triggers.',                                                                                                                                                                 tier: 'HIGH',   targetMin: 6, targetMax: 8 },
  { id: 3,  key: 'COMMUNICATION_STYLE',           label: 'Communication Style',          description: 'Language patterns, directness, framing, how they explain.',                                                                                                                                                                                       tier: 'HIGH',   targetMin: 6, targetMax: 8 },
  { id: 4,  key: 'IDENTITY_SELF_CONCEPT',         label: 'Identity & Self-Concept',      description: 'How they see and present themselves. Origin story, identity markers.',                                                                                                                                                                              tier: 'HIGH',   targetMin: 6, targetMax: 8 },
  { id: 5,  key: 'VALUES_HIERARCHY',              label: 'Values Hierarchy',             description: 'What they prioritize when values conflict. Trade-off decisions.',                                                                                                                                                                                   tier: 'HIGH',   targetMin: 6, targetMax: 8 },
  { id: 6,  key: 'CONTRADICTION_PATTERNS',        label: 'Contradiction Patterns',       description: 'Inconsistencies between stated and revealed preferences. Say/do gaps. MOST IMPORTANT — contradictions reveal where persuasion has maximum leverage.',                                                                                              tier: 'HIGH',   targetMin: 6, targetMax: 8 },
  { id: 7,  key: 'POWER_ANALYSIS',                label: 'Power Analysis',               description: 'How they read, navigate, and deploy power: structural position, coalition dynamics, information asymmetry, their implicit theory of how institutions actually work vs. how they\'re supposed to work, who they think the real decision-makers are.', tier: 'HIGH',   targetMin: 6, targetMax: 8 },
  // MEDIUM INVESTMENT (8-15)
  { id: 8,  key: 'INFLUENCE_SUSCEPTIBILITY',      label: 'Influence Susceptibility',     description: 'What persuades them, who they defer to, resistance patterns.',                                                                                                                                                                                    tier: 'MEDIUM', targetMin: 4, targetMax: 6 },
  { id: 9,  key: 'TIME_ORIENTATION',              label: 'Time Orientation',             description: 'Past/present/future emphasis, patience level, urgency triggers.',                                                                                                                                                                                   tier: 'MEDIUM', targetMin: 4, targetMax: 6 },
  { id: 10, key: 'BOUNDARY_CONDITIONS',           label: 'Boundary Conditions',          description: 'Hard limits and non-negotiables. Explicit red lines.',                                                                                                                                                                                             tier: 'MEDIUM', targetMin: 4, targetMax: 6 },
  { id: 11, key: 'EMOTIONAL_TRIGGERS',            label: 'Emotional Triggers',           description: 'What excites or irritates them. Energy shifts, enthusiasm spikes.',                                                                                                                                                                                 tier: 'MEDIUM', targetMin: 4, targetMax: 6 },
  { id: 12, key: 'RELATIONSHIP_PATTERNS',         label: 'Relationship Patterns',        description: 'How they engage with people. Loyalty, collaboration style.',                                                                                                                                                                                       tier: 'MEDIUM', targetMin: 4, targetMax: 6 },
  { id: 13, key: 'RISK_TOLERANCE',                label: 'Risk Tolerance',               description: 'Attitude toward uncertainty and failure. Bet-sizing, hedging.',                                                                                                                                                                                     tier: 'MEDIUM', targetMin: 4, targetMax: 6 },
  { id: 14, key: 'RESOURCE_PHILOSOPHY',           label: 'Resource Philosophy',          description: 'How they think about money, time, leverage.',                                                                                                                                                                                                      tier: 'MEDIUM', targetMin: 4, targetMax: 6 },
  { id: 15, key: 'COMMITMENT_PATTERNS',           label: 'Commitment Patterns',          description: 'How they make and keep commitments. Escalation, exit patterns.',                                                                                                                                                                                    tier: 'MEDIUM', targetMin: 4, targetMax: 6 },
  // LOW INVESTMENT (16-25)
  { id: 16, key: 'LEARNING_STYLE',                label: 'Learning Style',               description: 'How they take in new information. Reading vs conversation, deep dive vs summary.',                                                                                                                                                                tier: 'LOW',    targetMin: 1, targetMax: 3 },
  { id: 17, key: 'STATUS_RECOGNITION',            label: 'Status & Recognition',         description: 'How they relate to prestige and credit. Recognition needs.',                                                                                                                                                                                       tier: 'LOW',    targetMin: 1, targetMax: 3 },
  { id: 18, key: 'KNOWLEDGE_AREAS',               label: 'Knowledge Areas',              description: 'Domains of expertise and intellectual passion.',                                                                                                                                                                                                   tier: 'LOW',    targetMin: 1, targetMax: 3 },
  { id: 19, key: 'RETREAT_PATTERNS',              label: 'Retreat Patterns',             description: 'How they disengage, recover, reset. Procedural delays, topic shifts.',                                                                                                                                                                             tier: 'LOW',    targetMin: 1, targetMax: 3 },
  { id: 20, key: 'SHAME_DEFENSE_TRIGGERS',        label: 'Shame & Defense Triggers',     description: 'What they protect, what feels threatening. Ego-defense behavior when triggered.',                                                                                                                                                                  tier: 'LOW',    targetMin: 1, targetMax: 3 },
  { id: 21, key: 'REAL_TIME_INTERPERSONAL_TELLS', label: 'Real-Time Interpersonal Tells',description: 'Observable behavior in interaction. How they signal evaluation vs collaboration.',                                                                                                                                                                 tier: 'LOW',    targetMin: 1, targetMax: 3 },
  { id: 22, key: 'TEMPO_MANAGEMENT',              label: 'Tempo Management',             description: 'Pacing of decisions, conversations, projects. What each direction signals.',                                                                                                                                                                       tier: 'LOW',    targetMin: 1, targetMax: 3 },
  { id: 23, key: 'HIDDEN_FRAGILITIES',            label: 'Hidden Fragilities',           description: 'Vulnerabilities they manage or compensate for. What they\'re afraid is true about themselves or their work.',                                                                                                                                      tier: 'LOW',    targetMin: 1, targetMax: 3 },
  { id: 24, key: 'RECOVERY_PATHS',                label: 'Recovery Paths',               description: 'How they bounce back from setbacks. Reset mechanisms.',                                                                                                                                                                                            tier: 'LOW',    targetMin: 1, targetMax: 3 },
  { id: 25, key: 'CONDITIONAL_BEHAVIORAL_FORKS',  label: 'Conditional Behavioral Forks', description: 'When X happens, they do Y. When not-X, they do Z. Both branches for every pattern.',                                                                                                                                                              tier: 'LOW',    targetMin: 1, targetMax: 3 },
];

// ── Lookup helpers ──────────────────────────────────────────────────

const BY_KEY = new Map<DimensionKey, DimensionDef>();
const BY_ID = new Map<number, DimensionDef>();
for (const d of DIMENSIONS) {
  BY_KEY.set(d.key, d);
  BY_ID.set(d.id, d);
}

export function getDimension(key: DimensionKey): DimensionDef {
  return BY_KEY.get(key)!;
}

export function getDimensionById(id: number): DimensionDef | undefined {
  return BY_ID.get(id);
}

export function getDimensionsByTier(tier: InvestmentTier): DimensionDef[] {
  return DIMENSIONS.filter(d => d.tier === tier);
}

export const HIGH_TIER_DIMS = getDimensionsByTier('HIGH');
export const MEDIUM_TIER_DIMS = getDimensionsByTier('MEDIUM');
export const LOW_TIER_DIMS = getDimensionsByTier('LOW');

// ── Formatted dimension text for prompts ────────────────────────────

export function formatDimensionsForPrompt(): string {
  const lines: string[] = [];

  lines.push('HIGH INVESTMENT (6-8 evidence entries required):');
  for (const d of HIGH_TIER_DIMS) {
    lines.push(`${d.id.toString().padStart(2)}. ${d.key} — ${d.description}`);
  }

  lines.push('');
  lines.push('MEDIUM INVESTMENT (4-6 evidence entries required):');
  for (const d of MEDIUM_TIER_DIMS) {
    lines.push(`${d.id.toString().padStart(2)}. ${d.key} — ${d.description}`);
  }

  lines.push('');
  lines.push('LOW INVESTMENT (1-3 evidence entries required):');
  for (const d of LOW_TIER_DIMS) {
    lines.push(`${d.id.toString().padStart(2)}. ${d.key} — ${d.description}`);
  }

  return lines.join('\n');
}

/** Build the numbered key string used in JSON outputs: "1_DECISION_MAKING" */
export function dimKey(d: DimensionDef): string {
  return `${d.id}_${d.key}`;
}

// ── Source tier classification (5-tier for v5) ──────────────────────

export type SourceTier = 1 | 2 | 3 | 4 | 5;

export const SOURCE_TIER_LABELS: Record<SourceTier, string> = {
  1: 'Podcast/interview/video — unscripted voice',
  2: 'Press profile, journalist coverage, third-party analysis',
  3: 'Self-authored (op-eds, LinkedIn posts, blog)',
  4: 'Institutional evidence during tenure (inferential)',
  5: 'Structural records (990s, filings, lobbying registries)',
};

// ── Attribution types (Stage 3) ─────────────────────────────────────

export type AttributionType =
  | 'target_authored'
  | 'target_coverage'
  | 'institutional_inference'
  | 'target_reshare';

export type KillReason =
  | 'passive_interaction'
  | 'directory_listing'
  | 'wrong_attribution'
  | 'wrong_person';

// Migration artifacts (OLD_DIM_RENAMES, OLD_DIM_FOLDINS, resolveOldDimName) removed Feb 2026.
// No active code referenced them.
