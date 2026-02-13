export const EXTRACTION_PROMPT = `You are producing a behavioral evidence package for a profile writer. The writer will use your output — and only your output — to write a donor persuasion profile. They will not see the original sources. Every piece of the subject's original voice, situational detail, and surrounding context you leave out is gone forever.

Your job is CURATION, not analysis. You decide what to include and where to file it. The profile writer decides what it means.

PRESERVE ORIGINAL VOICE. Quote long. If a blog post builds an argument across three paragraphs, include the paragraph that carries the weight — not a six-word fragment. The subject's own words are the most valuable material in this package. When you have their actual language, use it. Do not paraphrase. Do not summarize what they said in your words when their words are available.

INCLUDE SURROUNDING TEXT. Don't just pull the key sentence. Give the sentences around it — the setup, the qualifier, the turn. The profile writer needs to hear tone and register, not just content. If a quote is funny, confrontational, measured, or raw, the surrounding text is what conveys that.

SITUATE WITH FACTS, NOT INTERPRETATION. For each entry, describe the factual situation: what was happening, who was involved, what year, what the stakes were. Do not describe what the quote "reveals" or "demonstrates" or "shows." The dimension heading already tells the writer the category. Your job is the evidence and the scene.

NOTE THE SOURCE SHAPE. One sentence: was this the thesis of a long essay, a throwaway aside, a live interview answer, a prepared talk? The writer needs to know how much weight the quote can bear.

USE TIER LABELS. Sources are labeled Tier 1 (subject's own voice), Tier 2 (third-party with quotes or behavioral descriptions), or Tier 3 (institutional/background). Invest extraction effort proportionally. A Tier 1 blog post deserves 300-token entries with long quotes. A Tier 3 org bio page might deserve a single factual sentence or nothing at all. When evidence conflicts between tiers, Tier 1 wins — the subject's own account of their values or decisions outweighs a third party's description.

PRIORITIZE FIRST-PERSON VOICE. Blog posts, interviews, essays, talks where the subject speaks in their own words are worth far more than institutional bios or press releases that describe them. If a dimension has both, lead with own-voice material.

INVEST UNEQUALLY. Some dimensions have rich evidence. Some are thin. Don't pad thin dimensions with weak entries. Concentrate your effort on the dimensions where the source material is strongest. Mark genuine evidence gaps as gaps.

DO NOT ANALYZE. Do not write "This reveals his governing framework." Do not write "Demonstrating high risk tolerance." Do not write "Showing comfort with narrative complexity." Do not write "suggesting that he values..." These are interpretive conclusions. They belong in the profile, not in the evidence package. Present the evidence. Describe the scene. Stop.

---

## ENTRY FORMAT

For each entry under a dimension, use this format:

ENTRY N:
"[Long quote — full passage, not a fragment]"
— Source: [URL or source name], [date if known]
— Shape: [One sentence: what kind of source this was and how much weight it can bear]

Surrounding: [The sentences before and after the key quote. The paragraph that sets it up. Enough that the writer can hear tone, register, and context. Also: factual situation — what was happening, who was involved, what year, what the stakes were.]

---

## DIMENSION BUDGET

Not all dimensions deserve equal space. Invest where the evidence is richest.

HIGH-INVESTMENT dimensions (~1,500-2,000 tokens each, 4-6 entries):
- DECISION_MAKING
- VALUES_HIERARCHY
- COMMUNICATION_STYLE
- CONTRADICTION_PATTERNS
- IDENTITY_SELF_CONCEPT
- COMMITMENT_PATTERNS

MEDIUM-INVESTMENT dimensions (~1,000-1,200 tokens each, 3-4 entries):
- TRUST_CALIBRATION
- INFLUENCE_SUSCEPTIBILITY
- BOUNDARY_CONDITIONS
- EMOTIONAL_TRIGGERS
- RISK_TOLERANCE
- RESOURCE_PHILOSOPHY
- TIME_ORIENTATION
- RELATIONSHIP_PATTERNS

LOW-INVESTMENT dimensions (~400-800 tokens each, 1-3 entries):
- LEARNING_STYLE
- STATUS_RECOGNITION
- KNOWLEDGE_AREAS
- RETREAT_PATTERNS
- SHAME_DEFENSE_TRIGGERS
- REAL_TIME_INTERPERSONAL_TELLS
- TEMPO_MANAGEMENT
- HIDDEN_FRAGILITIES
- RECOVERY_PATHS
- CONDITIONAL_BEHAVIORAL_FORKS

---

## THE 24 DIMENSIONS

### 1. DECISION_MAKING
How they evaluate proposals and opportunities. Speed of decisions, gut vs analysis, what triggers yes/no.

### 2. TRUST_CALIBRATION
What builds or breaks credibility. Verification behavior, skepticism triggers.

### 3. INFLUENCE_SUSCEPTIBILITY
What persuades them, who they defer to, resistance patterns.

### 4. COMMUNICATION_STYLE
Language patterns, directness, framing, how they explain.

### 5. LEARNING_STYLE
How they take in new information. Reading vs conversation, deep dive vs summary.

### 6. TIME_ORIENTATION
Past/present/future emphasis, patience level, urgency triggers.

### 7. IDENTITY_SELF_CONCEPT
How they see and present themselves. Origin story, identity markers.

### 8. VALUES_HIERARCHY
What they prioritize when values conflict. Trade-off decisions.

### 9. STATUS_RECOGNITION
How they relate to prestige and credit. Recognition needs.

### 10. BOUNDARY_CONDITIONS
Hard limits and non-negotiables. Explicit red lines.

### 11. EMOTIONAL_TRIGGERS
What excites or irritates them. Energy shifts, enthusiasm spikes.

### 12. RELATIONSHIP_PATTERNS
How they engage with people. Loyalty, collaboration style.

### 13. RISK_TOLERANCE
Attitude toward uncertainty and failure. Bet-sizing, hedging.

### 14. RESOURCE_PHILOSOPHY
How they think about money, time, leverage.

### 15. COMMITMENT_PATTERNS
How they make and keep commitments. Escalation, exit patterns.

### 16. KNOWLEDGE_AREAS
Domains of expertise and intellectual passion.

### 17. CONTRADICTION_PATTERNS
Inconsistencies between stated and revealed preferences. Say/do gaps. MOST IMPORTANT — contradictions reveal where persuasion has maximum leverage.

### 18. RETREAT_PATTERNS
What language/behavior they use when disengaging. Procedural delays, topic shifts.

### 19. SHAME_DEFENSE_TRIGGERS
What makes them shut down. Ego-defense behavior when triggered.

### 20. REAL_TIME_INTERPERSONAL_TELLS
How they signal evaluation vs collaboration. Energy shifts in conversation.

### 21. TEMPO_MANAGEMENT
How they speed up or slow down conversation. What each direction signals.

### 22. HIDDEN_FRAGILITIES
What they're afraid is true about themselves or their work.

### 23. RECOVERY_PATHS
What brings them back after withdrawal. Reset mechanisms.

### 24. CONDITIONAL_BEHAVIORAL_FORKS
When X happens, they do Y. When not-X, they do Z. Both branches for every pattern.

---

Your target output is 25,000-30,000 tokens. This is intentionally large. The profile writer needs this much original material to write at the quality level required. When in doubt, include more of the original source text, not less. Err toward preservation.

## OUTPUT STRUCTURE

# RESEARCH PACKAGE: [SUBJECT NAME]

## Research Summary
[2-3 sentences: who this person is, what kind of evidence you found, and what's missing]

## Evidence Gaps
[What you looked for but couldn't find. What dimensions have weak or no evidence. Be specific — this becomes the profile's evidence ceiling.]

## Sources Consulted
[List of URLs read, with one-line annotation: what it contained and whether it was own voice, interview, third-party, or institutional.]

## Behavioral Evidence Extraction

### 1. DECISION_MAKING
[entries in ENTRY format above]

### 2. TRUST_CALIBRATION
[entries]

### 3. INFLUENCE_SUSCEPTIBILITY
[entries]

### 4. COMMUNICATION_STYLE
[entries]

### 5. LEARNING_STYLE
[entries]

### 6. TIME_ORIENTATION
[entries]

### 7. IDENTITY_SELF_CONCEPT
[entries]

### 8. VALUES_HIERARCHY
[entries]

### 9. STATUS_RECOGNITION
[entries]

### 10. BOUNDARY_CONDITIONS
[entries]

### 11. EMOTIONAL_TRIGGERS
[entries]

### 12. RELATIONSHIP_PATTERNS
[entries]

### 13. RISK_TOLERANCE
[entries]

### 14. RESOURCE_PHILOSOPHY
[entries]

### 15. COMMITMENT_PATTERNS
[entries]

### 16. KNOWLEDGE_AREAS
[entries]

### 17. CONTRADICTION_PATTERNS
[entries]

### 18. RETREAT_PATTERNS
[entries]

### 19. SHAME_DEFENSE_TRIGGERS
[entries]

### 20. REAL_TIME_INTERPERSONAL_TELLS
[entries]

### 21. TEMPO_MANAGEMENT
[entries]

### 22. HIDDEN_FRAGILITIES
[entries]

### 23. RECOVERY_PATHS
[entries]

### 24. CONDITIONAL_BEHAVIORAL_FORKS
[entries]
`;

export interface LinkedInData {
  currentTitle: string;
  currentEmployer: string;
  linkedinSlug?: string;
  websites?: string[];
  careerHistory: Array<{
    title: string;
    employer: string;
    startDate: string;
    endDate: string | 'Present';
    description?: string;
  }>;
  education: Array<{
    institution: string;
    degree?: string;
    field?: string;
    years?: string;
  }>;
  skills?: string[];
  boards?: string[];
}

// Tier preamble for extraction — teaches the model to weight sources by tier
const TIER_PREAMBLE = `
## Source Tiering

Sources are labeled Tier 1, 2, or 3:

- **Tier 1** (Subject's own voice): Blog posts, interviews, podcasts, essays, social media posts where the subject speaks in first person. These reveal how they think, what they value, and how they make decisions. Weight heavily.

- **Tier 2** (Third-party with quotes): Press coverage, profiles, event recaps that include direct quotes or behavioral descriptions. Secondary evidence. Weight moderately.

- **Tier 3** (Institutional/background): Team pages, bios, press releases, tax filings. Confirms biographical facts but rarely contains behavioral evidence. Weight minimally.

When making behavioral inferences, prioritize Tier 1 evidence. A quote from the subject's own blog post is stronger evidence than a paraphrase in a press release.
`;

/**
 * Build the extraction prompt for a single Opus API call.
 *
 * This assembles the full source texts (not snippets) into a single prompt
 * that Opus reads in one pass to produce a 25-30K token research package.
 *
 * Context window budget (200K total):
 *   - Extraction instructions: ~5K tokens
 *   - Source texts: target 100-130K tokens
 *   - Output (max_tokens): 32K tokens
 *   - Safety margin: ~33K tokens
 *
 * Individual sources are capped at 50K chars (~12.5K tokens) to prevent
 * a single bloated page from dominating the budget. Sources exceeding the
 * total budget are dropped lowest-tier-first.
 */
export function buildExtractionPrompt(
  donorName: string,
  sources: { url: string; title: string; snippet: string; content?: string; tier?: number; tierReason?: string }[],
  linkedinData?: LinkedInData | null
): string {
  // Check if sources have tier info
  const hasTiers = sources.length > 0 && 'tier' in sources[0] && sources[0].tier;

  // Sort by tier (T1 first, T3 last) so highest-value sources are at the top
  const sorted = hasTiers
    ? [...sources].sort((a, b) => (a.tier || 3) - (b.tier || 3))
    : [...sources];

  // Token budget for source texts: ~130K tokens ≈ 520K chars
  // Context window: 200K tokens, max_tokens: 32K, prompt template: ~5K → 163K available
  // Using 520K chars (~130K tokens) leaves ~33K token safety margin
  const MAX_SOURCE_CHARS = 520_000;
  const MAX_SINGLE_SOURCE_CHARS = 50_000; // Cap individual sources to ~12.5K tokens
  let totalChars = 0;
  const includedSources: typeof sorted = [];

  for (const s of sorted) {
    let text = s.content || s.snippet || '';
    let charCount = text.length;
    // Truncate oversized individual sources (e.g. bloated Substack pages)
    if (charCount > MAX_SINGLE_SOURCE_CHARS) {
      console.log(`[Extraction] Truncating source ${s.url} from ${charCount} to ${MAX_SINGLE_SOURCE_CHARS} chars`);
      text = text.slice(0, MAX_SINGLE_SOURCE_CHARS);
      charCount = MAX_SINGLE_SOURCE_CHARS;
      s.content = text;
    }
    if (totalChars + charCount > MAX_SOURCE_CHARS && includedSources.length > 0) {
      console.log(`[Extraction] Dropping source ${s.url} (${charCount} chars) — would exceed ${MAX_SOURCE_CHARS} char budget`);
      continue;
    }
    totalChars += charCount;
    includedSources.push(s);
  }

  console.log(`[Extraction] Including ${includedSources.length}/${sources.length} sources, ~${Math.round(totalChars / 4)} tokens of source text`);

  // Format sources with full content
  const sourcesText = includedSources.map((s, i) => {
    const text = s.content || s.snippet;
    const tierLabel = s.tier ? ` [TIER ${s.tier}: ${s.tier === 1 ? "Subject's own voice" : s.tier === 2 ? 'Third-party with quotes' : 'Institutional/background'}]` : '';
    const tierInfo = s.tierReason ? `\nClassification: ${s.tierReason}` : '';
    return `${'='.repeat(60)}\nSOURCE ${i + 1}${tierLabel}\nURL: ${s.url}\nTitle: ${s.title}${tierInfo}\n${'='.repeat(60)}\n\n${text}`;
  }).join('\n\n');

  let linkedinSection = '';
  if (linkedinData) {
    linkedinSection = `
# CANONICAL BIOGRAPHICAL DATA (from LinkedIn)

This is authoritative biographical information. Use these facts as the default for job title, employer, and career history. Web sources may add context but LinkedIn is the primary source for biographical accuracy.

**Current Position:** ${linkedinData.currentTitle} at ${linkedinData.currentEmployer}

**Career History:**
${linkedinData.careerHistory.map(job =>
  `- ${job.title} at ${job.employer} (${job.startDate} - ${job.endDate})${job.description ? `\n  ${job.description}` : ''}`
).join('\n')}

**Education:**
${linkedinData.education.map(edu =>
  `- ${edu.institution}${edu.degree ? `, ${edu.degree}` : ''}${edu.field ? ` in ${edu.field}` : ''}${edu.years ? ` (${edu.years})` : ''}`
).join('\n')}

${linkedinData.boards?.length ? `**Board/Advisory Roles:**\n${linkedinData.boards.map(b => `- ${b}`).join('\n')}` : ''}

---

`;
  }

  const tierPreambleSection = hasTiers ? TIER_PREAMBLE : '';

  return `${EXTRACTION_PROMPT}
${tierPreambleSection}
${linkedinSection}# SOURCES FOR ${donorName.toUpperCase()}

The following are the full texts of ${includedSources.length} sources found during research. Read all of them. Your extraction should draw from every source that contains behavioral evidence.

${sourcesText}

---

Produce the behavioral evidence research package for ${donorName}.${hasTiers ? ' Prioritize Tier 1 sources — these contain the subject\'s own voice and are the strongest evidence.' : ''}${linkedinData ? ' Use the LinkedIn data as the canonical source for biographical facts (title, employer, career history, education).' : ''}`;
}
