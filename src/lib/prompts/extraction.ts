// Prompts for Step 2: Behavioral Dossier Extraction

export const DIMENSIONS = [
  { id: 'IDENTITY_FORMATION', name: 'Identity Formation', description: 'Formative experiences, mentors, failures, self-narrative' },
  { id: 'BIO_CONTEXT', name: 'Biographical Context', description: 'Class origin, geography, education, cultural identity' },
  { id: 'CAREER_ARC', name: 'Career Arc', description: 'Role patterns, transitions, power orientation' },
  { id: 'WORLDVIEW_ENGINE', name: 'Worldview Engine', description: 'Theory of change, what causes outcomes' },
  { id: 'POLITICS_PUBLIC_POSITIONS', name: 'Politics & Public Positions', description: 'Political posture, public vs. private stances' },
  { id: 'POWER_THEORY', name: 'Power Theory', description: 'How they think about leverage and change' },
  { id: 'MEETING_DYNAMICS', name: 'Meeting Dynamics', description: 'Tempo, testing, evaluation→collaboration shift' },
  { id: 'SOCIAL_PRESENCE', name: 'Social Presence', description: 'Informal settings, what animates or drains them' },
  { id: 'RETREAT_PATTERNS', name: 'Retreat Patterns', description: 'How they disengage, withdrawal signals' },
  { id: 'NETWORK_DYNAMICS', name: 'Network Dynamics', description: 'Who they trust, validators, gatekeepers' },
  { id: 'GIVING_HISTORY', name: 'Giving History', description: 'Patterns in what, how, and why they give' },
  { id: 'FUNDRAISING_ORIENTATION', name: 'Fundraising Orientation', description: 'If they fundraise: their philosophy' },
  { id: 'RISK_POSTURE', name: 'Risk Posture', description: 'Comfort with controversy and exposure' },
  { id: 'CONTRADICTIONS', name: 'Contradictions', description: 'Tensions between stated values and behavior - MOST IMPORTANT' },
  { id: 'SYSTEMS_FEAR', name: 'Systems Fear', description: 'Civic-scale anxiety driving engagement' },
  { id: 'IDIOSYNCRATIC_CUES', name: 'Idiosyncratic Cues', description: 'Quirks, hobbies, personal connection points' },
  { id: 'LOGISTICAL_PREFERENCES', name: 'Logistical Preferences', description: 'Timing, format, communication preferences' },
];

export const EXTRACTION_PROMPT = `You are extracting BEHAVIORAL EVIDENCE for donor profiling.

CRITICAL: This is NOT biographical extraction. You're looking for PATTERNS that predict how this person will behave in a meeting.

THE GOAL: Identify evidence that answers:
1. What triggers their engagement?
2. What causes their withdrawal?
3. How do they signal these shifts?
4. What contradictions create leverage?
5. What do they conspicuously NOT talk about?

THE 17 DIMENSIONS:

FORMATION (Who They Became):
1. IDENTITY_FORMATION - Formative experiences, mentors, failures, the story they tell
2. BIO_CONTEXT - Class origin, geography, education, cultural identity
3. CAREER_ARC - Role patterns, transitions, what kind of power they seek

ORIENTATION (How They See the World):
4. WORLDVIEW_ENGINE - Theory of change, what they think causes outcomes
5. POLITICS_PUBLIC_POSITIONS - Political posture, public vs. private stances
6. POWER_THEORY - How they think about leverage and change-making

BEHAVIOR (How They Move):
7. MEETING_DYNAMICS - Tempo, testing, evaluation→collaboration shift
8. SOCIAL_PRESENCE - Informal settings, what animates or drains them
9. RETREAT_PATTERNS - How they disengage, signals of withdrawal
10. NETWORK_DYNAMICS - Who they trust, validators, gatekeepers

INVESTMENT (How They Give):
11. GIVING_HISTORY - Patterns in what, how, and why they give
12. FUNDRAISING_ORIENTATION - If they fundraise: their philosophy
13. RISK_POSTURE - Comfort with controversy and exposure

LEVERAGE (Where Persuasion Lives):
14. CONTRADICTIONS - Tensions between stated values and behavior (MOST IMPORTANT)
15. SYSTEMS_FEAR - Civic-scale anxiety driving their engagement
16. IDIOSYNCRATIC_CUES - Quirks, hobbies, personal details
17. LOGISTICAL_PREFERENCES - Timing, format, communication preferences

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
