export const SOURCE_SCORING_PROMPT = `You are scoring research sources for behavioral signal density.

For each source, assess how much evidence it contains for each of 24 behavioral dimensions. Score each dimension 0-3:
- 0 = No relevant content
- 1 = Mentioned or indirect
- 2 = Direct quote or clear example
- 3 = Rich evidence with context, triggers, outcomes

TIER 1 — FOUNDATION (weight: 10 points each):
1. DECISION_MAKING — How they evaluate, what triggers yes/no, speed, gut vs. analysis
2. TRUST_CALIBRATION — What builds it, what breaks it, verification behavior
3. EMOTIONAL_TRIGGERS — What excites them, what irritates them, energy shifts
4. COMMUNICATION_STYLE — Language patterns, directness, framing, how they explain
5. CONTRADICTION_PATTERNS — Say/do gaps, tensions they live inside, leverage points

TIER 2 — MEETING INTELLIGENCE (weight: 7 points each):
6. CONDITIONAL_BEHAVIORAL_FORKS — When X, they do Y; when not-X, they do Z
7. RETREAT_PATTERNS — Specific language/behavior when disengaging
8. SHAME_DEFENSE_TRIGGERS — What shuts them down, ego-defense behavior
9. RECOVERY_PATHS — What brings them back after withdrawal
10. COMMITMENT_PATTERNS — How they escalate, how they exit
11. INFLUENCE_SUSCEPTIBILITY — What persuades them, who they defer to

TIER 3 — CONTEXT & DEPTH (weight: 4 points each):
12. IDENTITY_SELF_CONCEPT — How they see themselves, origin story
13. RELATIONSHIP_PATTERNS — Loyalty, collaboration style, conflict approach
14. BOUNDARY_CONDITIONS — Hard limits, dealbreakers
15. REAL_TIME_INTERPERSONAL_TELLS — Evaluation vs. collaboration signals
16. TEMPO_MANAGEMENT — Pacing, speed changes
17. HIDDEN_FRAGILITIES — What they're afraid is true

TIER 4 — BACKGROUND (weight: 2 points each):
18. VALUES_HIERARCHY — What they prioritize
19. STATUS_RECOGNITION — How they read prestige
20. RISK_TOLERANCE — Comfort with uncertainty
21. RESOURCE_PHILOSOPHY — How they think about money/time
22. TIME_ORIENTATION — Past/present/future focus
23. LEARNING_STYLE — How they absorb information
24. KNOWLEDGE_AREAS — Domains of expertise

OUTPUT FORMAT:

For each source, output JSON:
{
  "source_index": [number],
  "title": "[source title]",
  "scores": {
    "DECISION_MAKING": [0-3],
    "TRUST_CALIBRATION": [0-3],
    "EMOTIONAL_TRIGGERS": [0-3],
    "COMMUNICATION_STYLE": [0-3],
    "CONTRADICTION_PATTERNS": [0-3],
    "CONDITIONAL_BEHAVIORAL_FORKS": [0-3],
    "RETREAT_PATTERNS": [0-3],
    "SHAME_DEFENSE_TRIGGERS": [0-3],
    "RECOVERY_PATHS": [0-3],
    "COMMITMENT_PATTERNS": [0-3],
    "INFLUENCE_SUSCEPTIBILITY": [0-3],
    "IDENTITY_SELF_CONCEPT": [0-3],
    "RELATIONSHIP_PATTERNS": [0-3],
    "BOUNDARY_CONDITIONS": [0-3],
    "REAL_TIME_INTERPERSONAL_TELLS": [0-3],
    "TEMPO_MANAGEMENT": [0-3],
    "HIDDEN_FRAGILITIES": [0-3],
    "VALUES_HIERARCHY": [0-3],
    "STATUS_RECOGNITION": [0-3],
    "RISK_TOLERANCE": [0-3],
    "RESOURCE_PHILOSOPHY": [0-3],
    "TIME_ORIENTATION": [0-3],
    "LEARNING_STYLE": [0-3],
    "KNOWLEDGE_AREAS": [0-3]
  },
  "total_score": [calculated weighted sum],
  "word_count": [approximate word count of source]
}

Score ALL sources provided. Be rigorous — a score of 3 means genuinely rich behavioral evidence, not just mentions.
`;

export function buildScoringPrompt(
  donorName: string,
  sources: { url: string; title: string; snippet: string; content?: string }[]
): string {
  const sourcesText = sources.map((s, i) => {
    const text = s.content || s.snippet;
    const wordCount = text.split(/\s+/).length;
    return `### Source ${i + 1}: ${s.title}\nURL: ${s.url}\nWord count: ~${wordCount}\n\n${text}`;
  }).join('\n\n---\n\n');

  return `${SOURCE_SCORING_PROMPT}

---

# SOURCES FOR ${donorName.toUpperCase()}

${sourcesText}

---

Score each source above. Output as JSON array.`;
}

// Calculate weighted score from dimension scores
export function calculateWeightedScore(scores: Record<string, number>): number {
  const weights: Record<string, number> = {
    // Tier 1 - Foundation (10 points)
    DECISION_MAKING: 10,
    TRUST_CALIBRATION: 10,
    EMOTIONAL_TRIGGERS: 10,
    COMMUNICATION_STYLE: 10,
    CONTRADICTION_PATTERNS: 10,
    // Tier 2 - Meeting Intelligence (7 points)
    CONDITIONAL_BEHAVIORAL_FORKS: 7,
    RETREAT_PATTERNS: 7,
    SHAME_DEFENSE_TRIGGERS: 7,
    RECOVERY_PATHS: 7,
    COMMITMENT_PATTERNS: 7,
    INFLUENCE_SUSCEPTIBILITY: 7,
    // Tier 3 - Context & Depth (4 points)
    IDENTITY_SELF_CONCEPT: 4,
    RELATIONSHIP_PATTERNS: 4,
    BOUNDARY_CONDITIONS: 4,
    REAL_TIME_INTERPERSONAL_TELLS: 4,
    TEMPO_MANAGEMENT: 4,
    HIDDEN_FRAGILITIES: 4,
    // Tier 4 - Background (2 points)
    VALUES_HIERARCHY: 2,
    STATUS_RECOGNITION: 2,
    RISK_TOLERANCE: 2,
    RESOURCE_PHILOSOPHY: 2,
    TIME_ORIENTATION: 2,
    LEARNING_STYLE: 2,
    KNOWLEDGE_AREAS: 2,
  };

  let total = 0;
  for (const [dimension, density] of Object.entries(scores)) {
    const weight = weights[dimension] || 0;
    total += weight * density;
  }
  return total;
}

// Select top sources until word count target is reached
export function selectTopSources(
  scoredSources: Array<{ source_index: number; total_score: number; word_count: number }>,
  sources: Array<{ content?: string; snippet: string }>,
  targetWords: number = 30000
): Array<{ index: number; score: number; content: string }> {
  // Sort by score descending
  const sorted = [...scoredSources].sort((a, b) => b.total_score - a.total_score);

  const selected: Array<{ index: number; score: number; content: string }> = [];
  let cumulativeWords = 0;

  for (const scored of sorted) {
    const source = sources[scored.source_index - 1]; // source_index is 1-based
    if (!source) continue;
    const content = source.content || source.snippet;
    const wordCount = content.split(/\s+/).length;

    if (cumulativeWords + wordCount <= targetWords || selected.length === 0) {
      selected.push({
        index: scored.source_index,
        score: scored.total_score,
        content: content
      });
      cumulativeWords += wordCount;
    }

    if (cumulativeWords >= targetWords) break;
  }

  return selected;
}
