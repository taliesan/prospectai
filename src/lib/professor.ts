// Professor review — separate Opus API call that critiques a first draft
// against the full profiling canon and research package. Runs in its own
// context window with no access to exemplars.

import Anthropic from '@anthropic-ai/sdk';

export interface ProfessorResult {
  feedback: string;
  promptForDebug: string;
}

export async function runProfessorReview(
  firstDraft: string,
  researchPackage: string,
  professorCanon: string,
  donorName: string,
): Promise<ProfessorResult> {
  const client = new Anthropic();

  const systemPrompt = `You are a senior analytical reviewer for donor persuasion profiles. You have deep expertise in the methodology defined in the canon documents below. Your job is to critique the ANALYTICAL QUALITY of a first draft against this methodology.

You are NOT reviewing voice, prose style, or editorial craft. A separate editorial pass handles that. You are reviewing whether the analysis is correct, complete, and grounded — whether the profile understands the donor and gives the fundraiser what they need.

You will receive both the first draft AND the research package it was built from. Use the research package to verify claims, check for evidence that was missed, and assess whether the draft's conclusions are supported.

${professorCanon}`;

  const userMessage = `Review this first draft of a persuasion profile for ${donorName} against the canon methodology in your instructions and the research package below.

For each problem you find, state:
1. The exact text that fails (quote it)
2. Which canon principle it violates (cite the specific memo number, manual section, or field guide rule)
3. What specific evidence from the research package is being missed or misused
4. What the corrected version should DO differently (not the rewritten text — the analytical move)

---

## A. SUBSTRATE RECONSTRUCTION (Memo 1)

The profile must trace how the donor's operating system was FORMED, not just describe how it currently works. Check:

- Does Section 1 identify specific formative events (loss, institutional experience, early career choices) and show how they created the behavioral patterns the rest of the profile describes?
- Is there a causal chain from formation → identity → current behavior? Or does the profile just assert the identity exists?
- Search the research package for formation evidence the draft missed. Specifically look for: childhood or family events, early career experiences that created lasting patterns, moments where the donor chose a path that locked in their operating system.

When flagging: quote the specific formation evidence from the research package that should be in the profile but isn't. Name the causal chain that evidence would build.

## B. CONTRADICTION QUALITY (Memo 2)

The profile must center on ONE primary contradiction that creates persuasion leverage — meaning it opens a specific door for the fundraiser. Check:

- Is there a single load-bearing contradiction, or are there multiple competing ones?
- Does the contradiction predict meeting behavior? (When the fundraiser touches it, what happens? When they avoid it, what opens up?)
- Does the contradiction explain the donor's retreat patterns? (The thing they protect is usually one side of the contradiction.)
- Does the profile show specifically how the contradiction creates an opening for co-creation — a role that preserves what the donor must protect while letting them act toward what they say they want?

When flagging: state which contradiction should be primary and WHY — which one better predicts what happens in the room. Show how the secondary contradiction becomes supporting texture.

## C. DANGEROUS TRUTH (Memo 8)

The profile must surface the donor's governing civic diagnosis — what they believe is failing in the world, why it's failing, and what kind of intervention becomes necessary. Check:

- Is there an explicit dangerous truth, or does the profile just describe values?
- Does the dangerous truth come from the donor's own words and framing, not the profiler's analysis?
- Can the fundraiser use it to position their work inside the donor's worldview?

When flagging: search the research package for the donor's own language about what's broken. Quote the specific passages. Show what dangerous truth they assemble into.

## D. INTERIORITY (Memo 4, Cognition Manual Section 4)

Psychological claims must be structural and predictive — they must tell the fundraiser what will happen under specific conditions. Check:

- Are psychological claims expressed as predictions? ("When X happens, they do Y" rather than "They are [trait]")
- Does the interiority change what the fundraiser should do, or does it just sound deep?
- Are evaluative labels ("his superpower is...", "he's remarkably...", "she's genuinely...") replaced with behavioral observations?

When flagging: quote the evaluative language and show what predictive claim it should become. Use evidence from the research package to ground the prediction.

## E. PRESENCE AND RETREAT (Memos 5-6)

Shutdown triggers must be ordered by severity, each with a specific recovery move tied to the psychology that created the trigger. Check:

- Are triggers ordered from most to least severe?
- Does each trigger have a recovery move? Is the recovery specific to THIS donor's psychology, or is it generic advice?
- Do recovery moves connect back to the operating system and contradiction? (The recovery should use what you know about the donor to restore alignment.)
- Is there at least one trigger about the fundraiser's likely mistake, not just the donor's behavior?

When flagging: for each generic recovery, show what specific recovery the donor's psychology implies. Use evidence from the research package.

## F. COMMITMENT PATHWAY (Cognition Manual)

Section 6 must show the specific test transaction pattern THIS donor uses, with enough specificity that a fundraiser can replicate it. Check:

- Are there concrete examples from the donor's history showing how trust was built? (Specific organizations, specific amounts, specific timelines)
- Does the pattern connect to the engineering/systems identity from Section 1? (Test → verify → scale should mirror the donor's core methodology)
- Can a fundraiser reading this section design a first interaction that matches the pattern?

When flagging: search the research package for specific trust-building sequences the draft missed or described too generically. Quote them.

## G. EVIDENCE DEPLOYMENT (Field Guide)

Every claim must trace to specific evidence. Check:

- Are quotes deployed as proof for the analysis that follows, or as decoration?
- Are there analytical claims that float without any evidence anchor?
- Are evidence ceilings stated honestly where they exist, and do they create specific analytical boundaries rather than just disclaimers?

When flagging: quote the unsupported claim and state whether the research package contains evidence for it (which the draft missed) or doesn't (in which case the claim should be deleted).

## H. FABRICATED SPECIFICITY

Every specific number in the profile must be verified against the research package. Check EACH number:

- State the number as it appears in the profile
- Search the research package for the source
- If found: state the source and whether the profile's precision matches (e.g., source says "approximately $170 million" but profile says "$170 million" as fact)
- If NOT found: flag as potentially fabricated
- If the number is calculated or inferred: show the calculation and whether it's sound

This is the most important mechanical check. List every number. Miss none.

## I. REPEATED DEPLOYMENT

List every factual claim, quote, or analytical insight that appears more than once. For each:

- State where it FIRST appears (section and paragraph)
- State every subsequent appearance
- Assess whether the recurrence does NEW analytical work or is lazy repetition
- Load-bearing recurrence (the operating system naturally surfaces across contexts) is acceptable IF each appearance does different work. Same quote or number redeployed without new analysis is not.

Prioritize: which repetitions are most damaging to the profile's effectiveness?

## J. CROSS-SECTION INTEGRATION (Field Guide)

Later sections (4-7) must use the analytical framework established in sections 1-3. Check:

- Does Section 4 (real-time reads) use the operating system from Section 1 to predict behavior?
- Does Section 5 (shutdown) connect triggers to the contradiction from Section 2?
- Does Section 6 (commitment) mirror the methodology from Section 1?
- Does Section 7 (dinner party) reflect the values hierarchy from Section 3?
- Could any section be detached from the profile without losing anything? If yes, it fails.

When flagging: show specifically which framework from sections 1-3 should be powering the later section and isn't.

## K. THE "MOST IMPORTANT SENTENCE"

The profile flags one sentence as the most important. Evaluate:

- Does this sentence actually reframe the entire donor relationship?
- Would a fundraiser who read ONLY this sentence know the single most important thing about approaching this donor?
- Is there a better candidate in the profile that should carry this flag?

---

RESEARCH PACKAGE:

${researchPackage}

---

FIRST DRAFT:

${firstDraft}`;

  const response = await client.messages.create({
    model: 'claude-opus-4-20250514',
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  // Build debug-friendly prompt — truncate canon for display only (full canon was sent to API above)
  const promptForDebug = `=== PROFESSOR SYSTEM PROMPT ===
[Canon: ${professorCanon.length} chars — 4 methodology files]

${systemPrompt.slice(0, 500)}...

[TRUNCATED FOR DEBUG — full ${professorCanon.length} chars sent to API]

=== PROFESSOR USER MESSAGE ===
[Research package: ${researchPackage.length} chars]
[Draft: ${firstDraft.length} chars]
[Total user message: ${userMessage.length} chars]

${userMessage}`;

  return { feedback: text, promptForDebug };
}
