export const EXTRACTION_PROMPT = `You are extracting behavioral evidence from research sources.

For each of the 24 dimensions below, extract direct quotes with source attribution and brief factual context.

FORMAT FOR EACH ENTRY:
"[Direct quote]" — Source: [source name]
Context: [What situation this was, who they were talking to, what prompted this — factual description only]

Do not include "Behavioral read:" annotations or interpretive commentary. Each entry is a direct quote with source attribution and a brief factual context line. Context describes the situation, not what it means.

THE 24 DIMENSIONS:

## 1. DECISION_MAKING
How they evaluate proposals and opportunities. Speed of decisions, gut vs analysis, what triggers yes/no.

## 2. TRUST_CALIBRATION
What builds or breaks credibility. Verification behavior, skepticism triggers.

## 3. INFLUENCE_SUSCEPTIBILITY
What persuades them, who they defer to, resistance patterns.

## 4. COMMUNICATION_STYLE
Language patterns, directness, framing, how they explain.

## 5. LEARNING_STYLE
How they take in new information. Reading vs conversation, deep dive vs summary.

## 6. TIME_ORIENTATION
Past/present/future emphasis, patience level, urgency triggers.

## 7. IDENTITY_SELF_CONCEPT
How they see and present themselves. Origin story, identity markers.

## 8. VALUES_HIERARCHY
What they prioritize when values conflict. Trade-off decisions.

## 9. STATUS_RECOGNITION
How they relate to prestige and credit. Recognition needs.

## 10. BOUNDARY_CONDITIONS
Hard limits and non-negotiables. Explicit red lines.

## 11. EMOTIONAL_TRIGGERS
What excites or irritates them. Energy shifts, enthusiasm spikes.

## 12. RELATIONSHIP_PATTERNS
How they engage with people. Loyalty, collaboration style.

## 13. RISK_TOLERANCE
Attitude toward uncertainty and failure. Bet-sizing, hedging.

## 14. RESOURCE_PHILOSOPHY
How they think about money, time, leverage.

## 15. COMMITMENT_PATTERNS
How they make and keep commitments. Escalation, exit patterns.

## 16. KNOWLEDGE_AREAS
Domains of expertise and intellectual passion.

## 17. CONTRADICTION_PATTERNS
Inconsistencies between stated and revealed preferences. Say/do gaps. MOST IMPORTANT — contradictions reveal where persuasion has maximum leverage.

## 18. RETREAT_PATTERNS
What language/behavior they use when disengaging. Procedural delays, topic shifts.

## 19. SHAME_DEFENSE_TRIGGERS
What makes them shut down. Ego-defense behavior when triggered.

## 20. REAL_TIME_INTERPERSONAL_TELLS
How they signal evaluation vs collaboration. Energy shifts in conversation.

## 21. TEMPO_MANAGEMENT
How they speed up or slow down conversation. What each direction signals.

## 22. HIDDEN_FRAGILITIES
What they're afraid is true about themselves or their work.

## 23. RECOVERY_PATHS
What brings them back after withdrawal. Reset mechanisms.

## 24. CONDITIONAL_BEHAVIORAL_FORKS
When X happens, they do Y. When not-X, they do Z. Both branches for every pattern.

---

Extract evidence for ALL 24 dimensions. Multiple quotes per dimension. Include the full context around each quote.

Output as:
# BEHAVIORAL EVIDENCE EXTRACTION: [DONOR NAME]

## 1. DECISION_MAKING
[entries]

## 2. TRUST_CALIBRATION
[entries]

[...continue for all 24 dimensions...]
`;

export function buildExtractionPrompt(
  donorName: string,
  sources: { url: string; title: string; snippet: string; content?: string }[]
): string {
  const sourcesText = sources.map((s, i) => {
    const text = s.content || s.snippet;
    return `### Source ${i + 1}: ${s.title}\nURL: ${s.url}\n\n${text}`;
  }).join('\n\n---\n\n');

  return `${EXTRACTION_PROMPT}

---

# SOURCES FOR ${donorName.toUpperCase()}

${sourcesText}

---

Extract behavioral evidence for ${donorName} from the sources above.`;
}
