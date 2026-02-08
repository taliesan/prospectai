export const PROFILE_OUTPUT_INSTRUCTIONS = `You are writing a Persuasion Profile for donor profiling.

REGISTER RULES (non-negotiable):
- Write from inside the subject's behavioral logic, not about it from outside.
- Biography becomes behavioral force: not "she co-founded Recode" but "she exits institutions before they soften her edge."
- Traits become pressure-read results: not "she's direct" but "she tests for posture misalignment in the first 10 minutes."
- Values become posture in the room: not "she appreciates dialogue" but "she'll say 'interesting' and never take the meeting again."
- Psychological interpretation becomes pattern exposure: not "she gets frustrated" but "when someone uses her platform without matching her literacy, she switches to interview mode and doesn't come back."
- Every claim must be grounded in specific evidence from the sources — quotes, decisions, actions, patterns across appearances.

OUTPUT STRUCTURE (18 sections):

## Life and Career
Write 2-3 paragraphs summarizing this person's biographical background and career arc. Include: where they came from, key career moves, current position/focus, and any relevant personal facts (family, education, geography). This section is factual context-setting, not behavioral analysis — save insights for the later sections.

Then write one section for each of these 17 behavioral dimensions. Use the dimension name as the section header. Write substantive prose for each — this is long-form analysis, not bullet points.

1. Decision-Making Patterns
2. Trust Calibration
3. Influence Susceptibility
4. Communication Style
5. Learning Style
6. Time Orientation
7. Identity & Self-Concept
8. Values Hierarchy
9. Status & Recognition
10. Boundary Conditions
11. Emotional Triggers
12. Relationship Patterns
13. Risk Tolerance
14. Resource Philosophy
15. Commitment Patterns
16. Knowledge Areas
17. Contradiction Patterns — MOST IMPORTANT. Contradictions reveal where persuasion has maximum leverage.

INCORPORATING BEHAVIORAL DYNAMICS EVIDENCE:

The extraction evidence includes 7 additional behavioral dynamics dimensions. Fold this evidence into the relevant profile sections:

- "Emotional Triggers" should incorporate: SHAME_DEFENSE_TRIGGERS, HIDDEN_FRAGILITIES
- "Communication Style" should incorporate: RETREAT_PATTERNS, TEMPO_MANAGEMENT, REAL_TIME_INTERPERSONAL_TELLS
- "Relationship Patterns" should incorporate: RECOVERY_PATHS
- "Decision-Making Patterns" should incorporate: CONDITIONAL_BEHAVIORAL_FORKS

Every behavioral claim needs both branches of the fork. Not "he's direct" but "when X, he does Y; when not-X, he does Z."

OUTPUT: Long-form behavioral prose organized by the 18 sections above (Life and Career + 17 dimensions). Not bullet points. Each section should have a clear header and substantive analysis. Cross-reference across sources. Surface every signal, every quote, every contradiction, every conspicuous silence. Be expansive — more is more.`;

export function buildProfilePrompt(
  donorName: string,
  extractionOutput: string,
  geoffreyBlock: string
): string {
  return `${geoffreyBlock}

---

Here is the behavioral evidence extracted from research sources about ${donorName}:

${extractionOutput}

---

${PROFILE_OUTPUT_INSTRUCTIONS}

Title the document "${donorName} — Persuasion Profile" at the top.

Write a comprehensive Persuasion Profile for ${donorName}.`;
}
