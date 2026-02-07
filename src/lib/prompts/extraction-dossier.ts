export const BEHAVIORAL_EXTRACTION_PROMPT = `You are extracting verbatim evidence from research sources. Do not paraphrase. Do not interpret. Do not synthesize. Pull exact quotes, decisions, actions, and patterns.

For each dimension below, extract the raw evidence that reveals it. Use the "Look for" and "Example signals" as your guide.

---

DECISION & EVALUATION

1. DECISION_MAKING — How they evaluate proposals and opportunities
- Look for: Speed of decisions, need for consensus, data requirements, gut vs analysis, what triggers immediate yes/no, deliberation patterns
- Example signals: "I need to see the numbers" / "Let me sleep on it" / "I knew in the first 5 minutes"

2. TRUST_CALIBRATION — What builds or breaks their credibility assessment
- Look for: Credential weight, track record emphasis, referral importance, verification behavior, skepticism triggers
- Example signals: Who they cite approvingly, what due diligence they mention, red flags they've called out

3. INFLUENCE_SUSCEPTIBILITY — What persuades them and who they defer to
- Look for: Authority figures they respect, peer influence, data vs story preference, resistance patterns, contrarian tendencies
- Example signals: Mentions of advisors, "X convinced me", pushback patterns, independent streak

---

COMMUNICATION & STYLE

4. COMMUNICATION_STYLE — Language patterns and preferred framing
- Look for: Technical vs accessible language, storytelling, directness, humor use, formality level, metaphors they use
- Example signals: Jargon comfort, narrative structures, how they explain complex ideas

5. LEARNING_STYLE — How they take in new information
- Look for: Reading vs conversation preference, visual vs verbal, deep dive vs summary, question patterns
- Example signals: "Send me the deck" vs "Let's walk through it" / asks for examples vs principles

6. TIME_ORIENTATION — Temporal focus and urgency patterns
- Look for: Past/present/future emphasis, patience level, deadline behavior, legacy thinking, urgency triggers
- Example signals: Historical references, "in 10 years" framing, impatience signals, long-term vs quick wins

---

IDENTITY & VALUES

7. IDENTITY_SELF_CONCEPT — How they see and present themselves
- Look for: Self-narrative, origin story, identity markers, what they're proud of, what they downplay
- Example signals: Titles they use, stories they repeat, humble-brags, identity corrections

8. VALUES_HIERARCHY — What they prioritize when values conflict
- Look for: Trade-off decisions, principled stands, flexibility areas, core vs negotiable values
- Example signals: "I'll never compromise on X" / sacrifices they've made / what they've walked away from

9. STATUS_RECOGNITION — How they relate to prestige and credit
- Look for: Credit-sharing vs claiming, visibility preference, title sensitivity, recognition needs
- Example signals: Name-dropping patterns, anonymity preference, board seat interest, award mentions

10. BOUNDARY_CONDITIONS — Hard limits and non-negotiables
- Look for: Explicit red lines, dealbreakers, categorical refusals, ethical limits
- Example signals: "I don't do X" / past walk-aways / industries/causes they avoid

---

EMOTIONAL & RELATIONAL

11. EMOTIONAL_TRIGGERS — What excites or irritates them
- Look for: Enthusiasm spikes, frustration sources, passion topics, pet peeves, energy shifts
- Example signals: Animated language, criticism patterns, what makes them lean in or check out

12. RELATIONSHIP_PATTERNS — How they engage with people
- Look for: Loyalty dynamics, network maintenance, collaboration style, conflict approach
- Example signals: Long-term relationships mentioned, partnership language, solo vs team orientation

13. RISK_TOLERANCE — Attitude toward uncertainty and failure
- Look for: Bet-sizing, failure stories, hedging behavior, comfort with ambiguity, recovery patterns
- Example signals: "Calculated risk" vs "swing for fences" / how they discuss losses / insurance behavior

---

RESOURCES & COMMITMENT

14. RESOURCE_PHILOSOPHY — How they think about money, time, leverage
- Look for: ROI thinking, abundance vs scarcity mindset, leverage preferences, efficiency focus
- Example signals: Investment framing, time allocation, "bang for buck" language, scaling thinking

15. COMMITMENT_PATTERNS — How they make and keep commitments
- Look for: Promise-making style, follow-through evidence, commitment escalation, exit patterns
- Example signals: Multi-year vs annual giving, deepening involvement, graceful exits, ghosting

16. KNOWLEDGE_AREAS — Domains of expertise and intellectual passion
- Look for: Deep knowledge areas, amateur interests, blind spots, curiosity patterns
- Example signals: Technical depth, reading habits, conference attendance, questions they ask

---

LEVERAGE (MOST IMPORTANT)

17. CONTRADICTION_PATTERNS — Inconsistencies between stated and revealed preferences
- Look for: Say/do gaps, public vs private positions, aspirational vs actual behavior, rationalization patterns
- Example signals: Espoused values contradicted by actions, defensive topics, cognitive dissonance moments
- WHY THIS MATTERS: Contradictions reveal where persuasion has maximum leverage

---

BEHAVIORAL DYNAMICS

18. RETREAT_PATTERNS — What language do they use when disengaging?
- Look for: "Circle back," "interesting," "let me think about it" — each means something different
- Example signals: Procedural language, sudden formality, topic shifts, scheduling deferrals

19. SHAME_DEFENSE_TRIGGERS — What makes them shut down? What's the ego-defense behavior?
- Look for: Topics they redirect from, criticisms they over-respond to, identities they protect
- Example signals: Deflection patterns, humor as shield, sudden aggression, retreat to credentials

20. REAL_TIME_INTERPERSONAL_TELLS — How do they signal evaluation vs. collaboration?
- Look for: Body language cues mentioned in interviews, question patterns, energy shifts
- Example signals: Leaning in vs. back, question depth, "tell me more" vs. "got it"

21. TEMPO_MANAGEMENT — How do they speed up or slow down conversation? What does each signal?
- Look for: Pacing changes, when they interrupt, when they pause, when they rapid-fire
- Example signals: Urgency spikes, deliberate slowing, "let's step back," "wait—"

22. HIDDEN_FRAGILITIES — What are they afraid is true about themselves or their work?
- Look for: Defensive repetition, unsolicited justifications, what they preemptively explain
- Example signals: Repeated narratives that feel like self-reassurance, over-explained decisions

23. RECOVERY_PATHS — Once a trigger fires and they withdraw, what brings them back?
- Look for: What resets them after conflict, who they defer to, what reframes work
- Example signals: Humor that lands, acknowledgment patterns, topic pivots that re-engage

24. CONDITIONAL_BEHAVIORAL_FORKS — When X happens, they do Y. When not-X, they do Z.
- Look for: Every behavioral claim needs both branches. Not "they're direct" but "when trusted, direct; when uncertain, procedural"
- Example signals: Contrasting behaviors across different contexts or relationships

---

OUTPUT FORMAT

For each of the 24 dimensions, provide comprehensive behavioral evidence:

## [NUMBER]. [DIMENSION NAME]

For each piece of evidence:
- The verbatim quote (in quotation marks)
- Source: [article/interview title]
- Context: What was happening? Who was the audience? What prompted this?
- Behavioral read: What does this reveal about how they operate?

Cross-reference: Note connections to other dimensions where relevant.

TARGET LENGTH: ~1,200-1,500 words per dimension (~30,000 words total)

Extract EVERYTHING relevant. More is better. The profile-writing stage needs enough raw material to stay grounded in specific observations for the entire output.

Prioritize:
- Quotes that reveal behavioral patterns, not just stated positions
- Conditional behaviors (when X, they do Y; when not-X, they do Z)
- Retreat signals, defense mechanisms, recovery patterns
- Real-time interpersonal dynamics, not just retrospective self-description

If no evidence exists for a dimension, write:

## [NUMBER]. [NAME]
No evidence found.

---

CRITICAL RULES:
- Do not interpret. Do not synthesize. Do not transform language.
- Pull exact quotes with quotation marks.
- Describe actions factually without editorializing.
- Include source attribution for every piece of evidence.
- Provide behavioral context around each quote — situation, audience, what prompted it.
- If a quote reveals multiple dimensions, include it under each relevant one.
- For every behavioral claim, extract both branches: when X, they do Y; when not-X, they do Z.
- Extract everything. Volume matters. The profile step needs dense raw material to stay grounded.
`;

export function buildExtractionPrompt(
  donorName: string,
  sources: { url: string; title: string; snippet: string; content?: string }[]
): string {
  const sourcesText = sources.map((s, i) => {
    const content = s.content || s.snippet;
    return `### Source ${i + 1}: ${s.title}\nURL: ${s.url}\n\n${content}`;
  }).join('\n\n---\n\n');

  return `${BEHAVIORAL_EXTRACTION_PROMPT}

---

# SOURCES FOR ${donorName.toUpperCase()}

${sourcesText}

---

Extract behavioral evidence for ${donorName} from the sources above. Output verbatim quotes and actions organized by the 24 dimensions. Be exhaustive — extract everything.`;
}
