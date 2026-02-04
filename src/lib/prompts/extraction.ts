// Prompts for Step 2: Behavioral Dossier Extraction

export const DIMENSIONS = [
  { id: 'DECISION_MAKING', name: 'Decision-Making Patterns', description: 'How they evaluate proposals, what triggers yes/no, deliberation style' },
  { id: 'TRUST_CALIBRATION', name: 'Trust Calibration', description: 'What builds/breaks credibility, trust signals, verification behavior' },
  { id: 'COMMUNICATION_STYLE', name: 'Communication Style', description: 'Language patterns, what resonates, preferred framing' },
  { id: 'RESOURCE_PHILOSOPHY', name: 'Resource Philosophy', description: 'How they think about money, time, leverage, ROI' },
  { id: 'IDENTITY_SELF_CONCEPT', name: 'Identity & Self-Concept', description: 'How they see themselves, self-narrative, identity markers' },
  { id: 'EMOTIONAL_TRIGGERS', name: 'Emotional Triggers', description: 'What excites them, what irritates, emotional hot buttons' },
  { id: 'RELATIONSHIP_PATTERNS', name: 'Relationship Patterns', description: 'How they engage with people, loyalty dynamics, social orientation' },
  { id: 'RISK_TOLERANCE', name: 'Risk Tolerance', description: 'Attitude toward uncertainty, comfort with ambiguity, failure response' },
  { id: 'TIME_ORIENTATION', name: 'Time Orientation', description: 'Past/present/future focus, urgency, patience, timeline preferences' },
  { id: 'VALUES_HIERARCHY', name: 'Values Hierarchy', description: 'What they prioritize when values conflict, non-negotiables' },
  { id: 'KNOWLEDGE_AREAS', name: 'Knowledge Areas', description: 'Domains of expertise/interest, intellectual passions, blind spots' },
  { id: 'INFLUENCE_SUSCEPTIBILITY', name: 'Influence Susceptibility', description: 'What persuades them, who they defer to, resistance patterns' },
  { id: 'CONTRADICTION_PATTERNS', name: 'Contradiction Patterns', description: 'Inconsistencies in stated vs revealed preferences - MOST IMPORTANT' },
  { id: 'STATUS_RECOGNITION', name: 'Status & Recognition', description: 'How they relate to prestige, credit-seeking, visibility preferences' },
  { id: 'LEARNING_STYLE', name: 'Learning Style', description: 'How they take in new information, processing preferences' },
  { id: 'COMMITMENT_PATTERNS', name: 'Commitment Patterns', description: 'How they make and keep commitments, follow-through behavior' },
  { id: 'BOUNDARY_CONDITIONS', name: 'Boundary Conditions', description: 'Hard limits, non-negotiables, dealbreakers, red lines' },
];

export const EXTRACTION_PROMPT = `You are extracting BEHAVIORAL EVIDENCE for donor profiling.

CRITICAL: This is NOT biographical extraction. You're looking for PATTERNS that predict how this person will behave in a meeting.

THE GOAL: Identify evidence that answers:
1. What triggers their engagement?
2. What causes their withdrawal?
3. How do they signal these shifts?
4. What contradictions create leverage?
5. What do they conspicuously NOT talk about?

THE 17 BEHAVIORAL DIMENSIONS:

DECISION & EVALUATION:
1. DECISION_MAKING - How they evaluate proposals and opportunities
   Look for: Speed of decisions, need for consensus, data requirements, gut vs analysis, what triggers immediate yes/no, deliberation patterns
   Example signals: "I need to see the numbers" / "Let me sleep on it" / "I knew in the first 5 minutes"

2. TRUST_CALIBRATION - What builds or breaks their credibility assessment
   Look for: Credential weight, track record emphasis, referral importance, verification behavior, skepticism triggers
   Example signals: Who they cite approvingly, what due diligence they mention, red flags they've called out

3. INFLUENCE_SUSCEPTIBILITY - What persuades them and who they defer to
   Look for: Authority figures they respect, peer influence, data vs story preference, resistance patterns, contrarian tendencies
   Example signals: Mentions of advisors, "X convinced me", pushback patterns, independent streak

COMMUNICATION & STYLE:
4. COMMUNICATION_STYLE - Language patterns and preferred framing
   Look for: Technical vs accessible language, storytelling, directness, humor use, formality level, metaphors they use
   Example signals: Jargon comfort, narrative structures, how they explain complex ideas

5. LEARNING_STYLE - How they take in new information
   Look for: Reading vs conversation preference, visual vs verbal, deep dive vs summary, question patterns
   Example signals: "Send me the deck" vs "Let's walk through it" / asks for examples vs principles

6. TIME_ORIENTATION - Temporal focus and urgency patterns
   Look for: Past/present/future emphasis, patience level, deadline behavior, legacy thinking, urgency triggers
   Example signals: Historical references, "in 10 years" framing, impatience signals, long-term vs quick wins

IDENTITY & VALUES:
7. IDENTITY_SELF_CONCEPT - How they see and present themselves
   Look for: Self-narrative, origin story, identity markers, what they're proud of, what they downplay
   Example signals: Titles they use, stories they repeat, humble-brags, identity corrections

8. VALUES_HIERARCHY - What they prioritize when values conflict
   Look for: Trade-off decisions, principled stands, flexibility areas, core vs negotiable values
   Example signals: "I'll never compromise on X" / sacrifices they've made / what they've walked away from

9. STATUS_RECOGNITION - How they relate to prestige and credit
   Look for: Credit-sharing vs claiming, visibility preference, title sensitivity, recognition needs
   Example signals: Name-dropping patterns, anonymity preference, board seat interest, award mentions

10. BOUNDARY_CONDITIONS - Hard limits and non-negotiables
    Look for: Explicit red lines, dealbreakers, categorical refusals, ethical limits
    Example signals: "I don't do X" / past walk-aways / industries/causes they avoid

EMOTIONAL & RELATIONAL:
11. EMOTIONAL_TRIGGERS - What excites or irritates them
    Look for: Enthusiasm spikes, frustration sources, passion topics, pet peeves, energy shifts
    Example signals: Animated language, criticism patterns, what makes them lean in or check out

12. RELATIONSHIP_PATTERNS - How they engage with people
    Look for: Loyalty dynamics, network maintenance, collaboration style, conflict approach
    Example signals: Long-term relationships mentioned, partnership language, solo vs team orientation

13. RISK_TOLERANCE - Attitude toward uncertainty and failure
    Look for: Bet-sizing, failure stories, hedging behavior, comfort with ambiguity, recovery patterns
    Example signals: "Calculated risk" vs "swing for fences" / how they discuss losses / insurance behavior

RESOURCES & COMMITMENT:
14. RESOURCE_PHILOSOPHY - How they think about money, time, leverage
    Look for: ROI thinking, abundance vs scarcity mindset, leverage preferences, efficiency focus
    Example signals: Investment framing, time allocation, "bang for buck" language, scaling thinking

15. COMMITMENT_PATTERNS - How they make and keep commitments
    Look for: Promise-making style, follow-through evidence, commitment escalation, exit patterns
    Example signals: Multi-year vs annual giving, deepening involvement, graceful exits, ghosting

16. KNOWLEDGE_AREAS - Domains of expertise and intellectual passion
    Look for: Deep knowledge areas, amateur interests, blind spots, curiosity patterns
    Example signals: Technical depth, reading habits, conference attendance, questions they ask

LEVERAGE (MOST IMPORTANT):
17. CONTRADICTION_PATTERNS - Inconsistencies between stated and revealed preferences
    Look for: Say/do gaps, public vs private positions, aspirational vs actual behavior, rationalization patterns
    Example signals: Espoused values contradicted by actions, defensive topics, cognitive dissonance moments
    WHY THIS MATTERS: Contradictions reveal where persuasion has maximum leverage

---

FOR EACH DIMENSION WITH EVIDENCE IN THIS SOURCE:

## [DIMENSION_NAME]

**Pattern:** [One-sentence behavioral pattern]
**Trigger:** [What activates this]
**Response:** [How they behave]
**Tell:** [Observable signal]
**Evidence:** [Direct quote or specific action with context]
**Confidence:** [HIGH/MEDIUM/LOW]
**Confidence Reason:** [Why this rating]
**Meeting Implication:** [How this changes approach]

---

FOR EVIDENCE OF ABSENCE (if notable):

## [DIMENSION_NAME] — ABSENCE

**Notable Silence:** [What they don't discuss despite relevance]
**Significance:** [Why this might matter]

---

RULES:
- Only extract what's IN THIS SOURCE
- Include direct quotes when available
- If a dimension has no evidence, skip it
- Flag conspicuous silences
- Focus on MEETING IMPLICATIONS
- Behavior > beliefs > facts`;

export function createExtractionPrompt(donorName: string, source: { title: string; url: string; type: string }, content: string): string {
  return `${EXTRACTION_PROMPT}

---

DONOR: ${donorName}

SOURCE:
Title: ${source.title}
URL: ${source.url}
Type: ${source.type}

CONTENT:
${content.slice(0, 12000)} ${content.length > 12000 ? '\n[Content truncated...]' : ''}

---

Extract behavioral evidence across all applicable dimensions. Output in the format specified above.`;
}

// Batch extraction prompt for processing multiple sources in one API call
export const BATCH_EXTRACTION_PROMPT = `You are extracting BEHAVIORAL EVIDENCE for donor profiling from MULTIPLE SOURCES.

CRITICAL: This is NOT biographical extraction. You're looking for PATTERNS that predict how this person will behave in a meeting.

THE GOAL: For EACH source, identify evidence that answers:
1. What triggers their engagement?
2. What causes their withdrawal?
3. How do they signal these shifts?
4. What contradictions create leverage?
5. What do they conspicuously NOT talk about?

THE 17 BEHAVIORAL DIMENSIONS:

DECISION & EVALUATION:
1. DECISION_MAKING - How they evaluate proposals and opportunities
   Look for: Speed of decisions, need for consensus, data requirements, gut vs analysis, what triggers immediate yes/no

2. TRUST_CALIBRATION - What builds or breaks their credibility assessment
   Look for: Credential weight, track record emphasis, referral importance, verification behavior, skepticism triggers

3. INFLUENCE_SUSCEPTIBILITY - What persuades them and who they defer to
   Look for: Authority figures they respect, peer influence, data vs story preference, resistance patterns

COMMUNICATION & STYLE:
4. COMMUNICATION_STYLE - Language patterns and preferred framing
   Look for: Technical vs accessible language, storytelling, directness, humor use, formality level

5. LEARNING_STYLE - How they take in new information
   Look for: Reading vs conversation preference, visual vs verbal, deep dive vs summary, question patterns

6. TIME_ORIENTATION - Temporal focus and urgency patterns
   Look for: Past/present/future emphasis, patience level, deadline behavior, legacy thinking

IDENTITY & VALUES:
7. IDENTITY_SELF_CONCEPT - How they see and present themselves
   Look for: Self-narrative, origin story, identity markers, what they're proud of, what they downplay

8. VALUES_HIERARCHY - What they prioritize when values conflict
   Look for: Trade-off decisions, principled stands, flexibility areas, core vs negotiable values

9. STATUS_RECOGNITION - How they relate to prestige and credit
   Look for: Credit-sharing vs claiming, visibility preference, title sensitivity, recognition needs

10. BOUNDARY_CONDITIONS - Hard limits and non-negotiables
    Look for: Explicit red lines, dealbreakers, categorical refusals, ethical limits

EMOTIONAL & RELATIONAL:
11. EMOTIONAL_TRIGGERS - What excites or irritates them
    Look for: Enthusiasm spikes, frustration sources, passion topics, pet peeves, energy shifts

12. RELATIONSHIP_PATTERNS - How they engage with people
    Look for: Loyalty dynamics, network maintenance, collaboration style, conflict approach

13. RISK_TOLERANCE - Attitude toward uncertainty and failure
    Look for: Bet-sizing, failure stories, hedging behavior, comfort with ambiguity

RESOURCES & COMMITMENT:
14. RESOURCE_PHILOSOPHY - How they think about money, time, leverage
    Look for: ROI thinking, abundance vs scarcity mindset, leverage preferences, efficiency focus

15. COMMITMENT_PATTERNS - How they make and keep commitments
    Look for: Promise-making style, follow-through evidence, commitment escalation, exit patterns

16. KNOWLEDGE_AREAS - Domains of expertise and intellectual passion
    Look for: Deep knowledge areas, amateur interests, blind spots, curiosity patterns

LEVERAGE (MOST IMPORTANT):
17. CONTRADICTION_PATTERNS - Inconsistencies between stated and revealed preferences
    Look for: Say/do gaps, public vs private positions, aspirational vs actual behavior
    WHY THIS MATTERS: Contradictions reveal where persuasion has maximum leverage

---

OUTPUT FORMAT:
Return a JSON array with one object per source. Each object must have:
- "source_index": The source number (1, 2, 3, etc.)
- "url": The source URL
- "extractions": An array of dimension extractions

Each extraction in the "extractions" array should have:
- "dimension": The dimension name (e.g., "IDENTITY_FORMATION")
- "pattern": One-sentence behavioral pattern
- "trigger": What activates this
- "response": How they behave
- "tell": Observable signal
- "evidence": Direct quote or specific action with context
- "confidence": "HIGH", "MEDIUM", or "LOW"
- "confidence_reason": Why this rating
- "meeting_implication": How this changes approach

If a dimension shows notable absence, use:
- "dimension": The dimension name
- "type": "ABSENCE"
- "notable_silence": What they don't discuss despite relevance
- "significance": Why this might matter

---

RULES:
- Process EACH source independently
- Only extract what's IN EACH SOURCE
- Include direct quotes when available
- If a dimension has no evidence in a source, skip it for that source
- Flag conspicuous silences
- Focus on MEETING IMPLICATIONS
- Behavior > beliefs > facts
- Return VALID JSON only`;

export function createBatchExtractionPrompt(
  donorName: string,
  sources: { title: string; url: string; type: string; content: string }[]
): string {
  const sourcesText = sources.map((source, index) => {
    const truncatedContent = source.content.slice(0, 8000);
    const isTruncated = source.content.length > 8000;
    return `
=== SOURCE ${index + 1} ===
Title: ${source.title}
URL: ${source.url}
Type: ${source.type}

CONTENT:
${truncatedContent}${isTruncated ? '\n[Content truncated...]' : ''}
`;
  }).join('\n---\n');

  return `${BATCH_EXTRACTION_PROMPT}

---

DONOR: ${donorName}

${sourcesText}

---

Extract behavioral evidence from ALL ${sources.length} sources above. Return a JSON array with extractions for each source.`;
}

export const SYNTHESIS_PROMPT = `You are synthesizing behavioral patterns from extracted evidence.

For each dimension with evidence, produce:

1. SUMMARY SENTENCE:
One-line TLDR for this dimension (e.g., "Seeks consensus but acts unilaterally when blocked.")

2. PRIMARY PATTERNS (2-4):
For each:
- State the behavioral pattern
- Note source count and diversity
- Identify triggers and responses
- Flag observable tells
- State meeting implication

3. CONTRADICTIONS (if any):
- Stated value vs. revealed behavior
- Status: ACTIVE (still creates friction) or RESOLVED (integrated into identity)
- How they navigate the tension
- Multi-source evidence

4. EVIDENCE OF ABSENCE:
- What's conspicuously missing from this dimension
- Why that silence might matter

5. SIGNAL STRENGTH:
- STRONG: 5+ sources, consistent across contexts (or depth override from single revealing source)
- MEDIUM: 3-4 sources, mostly consistent
- WEAK: 1-2 sources or conflicting signals

6. TRAJECTORY (if temporal data exists):
- INCREASING / STABLE / DECREASING / UNKNOWN

7. CURRENT SALIENCE (for dimensions 11-15):
- HOT / WARM / COOL / UNKNOWN

8. MEETING IMPLICATIONS:
- How will this show up in conversation?
- What should the asker do?
- What should the asker avoid?
- What would surprise this donor?

Be specific. Be behavioral. Be actionable.`;

export const CROSS_CUTTING_PROMPT = `You have synthesized all 17 dimensions for this donor. Now identify the cross-cutting patterns.

1. CORE CONTRADICTION:
The primary tension that explains behavior across multiple dimensions.
- State the contradiction in one sentence
- Show how it manifests in at least 3 different dimensions
- Explain why this tension is load-bearing (central to understanding them)
- Classify as ACTIVE (unresolved, creates friction) or RESOLVED (acknowledged, integrated)

2. DANGEROUS TRUTH:
The civic-scale fear driving their engagement.
- What do they believe is at stake?
- What system-level failure keeps them up at night?
- How does this fear shape what they fund/support?
- Evidence from the dossier

3. SUBSTRATE ARCHITECTURE:
The minimal internal structure that explains all patterns:
- Identity Boundary: What must remain true for them to stay engaged?
- Worldview Compression: How do they simplify complex situations?
- Incentive Thresholds: What risks will they take vs. avoid?
- Authorship Tolerance: What role do they need to feel legitimate?
- Exposure Management: How do they handle visibility?

Be specific to this donor. Avoid generic statements that could apply to anyone.`;
