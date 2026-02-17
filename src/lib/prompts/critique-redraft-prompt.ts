// STAGE 4b: Critique and Redraft Pass — added 2026-02-09
// Revert by setting ENABLE_CRITIQUE_REDRAFT = false in conversation-pipeline.ts

import type { LinkedInData } from './extraction-prompt';

export function buildCritiqueRedraftPrompt(
  donorName: string,
  firstDraftProfile: string,
  geoffreyBlock: string,
  exemplars: string,
  extractionOutput: string,
  linkedinData?: LinkedInData | null
): string {
  let prompt = '';

  // Layer 0: Role framing — tells the model it is editing, not writing
  prompt += `You are editing a first draft of a donor persuasion profile, not writing one.  You'll receive, in order: the voice and register standard, three exemplar profiles, canonical biographical data, behavioral evidence from research, the first draft, and editorial instructions. Read everything. The editorial instructions at the end tell you exactly what to do.

---

`;

  // Layer 1: Geoffrey Block v2
  prompt += geoffreyBlock;
  prompt += '\n\n';

  // Layer 2: Exemplar Profiles
  prompt += `---

${exemplars}

`;

  // Layer 3: Canonical Biographical Data (if available)
  if (linkedinData) {
    prompt += `---

# CANONICAL BIOGRAPHICAL DATA

Use this as the authoritative source for biographical facts.

**Current Position:** ${linkedinData.currentTitle} at ${linkedinData.currentEmployer}

**Career History:**
${linkedinData.careerHistory?.map(job => `- ${job.title} at ${job.employer} (${job.startDate} - ${job.endDate})`).join('\n') || 'Not available'}

**Education:**
${linkedinData.education?.map(edu => `- ${edu.institution}${edu.degree ? `: ${edu.degree}` : ''}${edu.field ? ` in ${edu.field}` : ''} (${edu.years})`).join('\n') || 'Not available'}

${linkedinData.boards?.length ? `**Board/Advisory Roles:**\n${linkedinData.boards.map(b => `- ${b}`).join('\n')}` : ''}

`;
  }

  // Layer 4: Behavioral Evidence
  prompt += `---

# BEHAVIORAL EVIDENCE

The following behavioral evidence was extracted from research sources about ${donorName}. Use it to verify claims in the first draft and identify unsupported assertions.

`;
  prompt += extractionOutput;
  prompt += '\n\n';

  // Layer 5: First Draft Profile
  prompt += `---

# FIRST DRAFT

The following is the first draft of the Persuasion Profile for ${donorName}. Your job is to produce the final version by applying the editorial process described in the instructions below.

`;
  prompt += firstDraftProfile;
  prompt += '\n\n';

  // Layer 6: Editorial Instructions
  prompt += `---

# EDITORIAL INSTRUCTIONS

You are producing the final version of this Persuasion Profile. You have the Geoffrey Block (the voice standard), three exemplar profiles (the production standard), the original behavioral evidence, and a first draft. Your job is to make the final version read like the exemplars.

## Your Standard

Reread the three exemplar profiles. Notice:

- How sections vary from one sentence to three paragraphs based on what the evidence actually supports
- How an insight appears once with full force and later sections reference it rather than re-derive it
- How quotes deploy once, as proof of a behavioral claim, never repeated
- How the profile models the person, not their organization or field
- How the register stays dry, compressed, and tactical from first section to last

The first draft gets some of this right and some of it wrong. Your job is to close the gap.

## What to do

**Verify against evidence.** Read every factual claim in the first draft against the canonical biographical data and behavioral evidence. If the draft says something the evidence doesn't say — or misreads what the evidence says — fix it or flag it.

**Raise the sophistication.** Where the first draft describes what someone did, convert it to behavioral inference about how they operate. Where it describes an institution's work, redirect it to model the individual's behavioral architecture within that institution. The exemplars never describe organizations — they describe how the person moves through and uses organizations. Apply that standard.

**Compress restatement.** The first draft likely repeats its core thesis across many sections. Find the section where the insight first deploys with full analytical treatment. That stays. Every other appearance gets compressed to a single-sentence reference or gets cut. If a section is entirely composed of insights already deployed elsewhere, reduce it to one or two sentences that hold the slot and do whatever small amount of new work the evidence supports.

**Deduplicate quotes.** If the same quote appears in multiple sections, keep the strongest deployment. Cut the rest.

**Earn every paragraph.** Compare each section's length against the equivalent section in the exemplars. If your section is longer and the additional length isn't doing new analytical work the exemplars would recognize as earning its space, cut until it does.

**Add evidence ceiling brackets** where the first draft makes claims the behavioral evidence doesn't support but failed to flag the gap.

**EXEMPLAR BLEED CHECK — HARD FAILURE:** Read every direct quote in this profile. For each one, verify: does this quote come from a source document about this donor, or does it appear in one of the exemplar profiles (Newmark, Bahat, McGlinchey)?

If ANY quote from the exemplar profiles appears in this profile — even if it would perfectly describe this donor — remove it immediately. Replace it with either: (a) A quote from this donor's actual source material, or (b) An analytical observation in the profile's own voice.

This is the single most damaging error a profile can contain. A transplanted quote means the profile is describing someone else's behavior, attributed to this donor. It destroys the profile's credibility with anyone who knows the donor.

Also check for close paraphrases of exemplar language. If a sentence in this profile closely mirrors a distinctive phrase from an exemplar (e.g., "work is broken in America," "everyone wants you to be blunt and transparent"), it is likely contaminated. Rewrite from this donor's own evidence.

## What not to do

**Do not invent.** Every behavioral claim in the final version must be supportable by the extraction evidence or the canonical biographical data provided. You can make sharper inferences from the same evidence. You cannot introduce evidence that isn't there.

**Do not soften.** The Geoffrey Block register must survive. If you find yourself writing smoother, more diplomatic, more consultative prose than the first draft, you're moving in the wrong direction. The exemplars are dry, compressed, and tactical. Match them.

## Structural requirements (non-negotiable)

- All 7 sections with exact headings, in order:
  1. The Operating System
  2. The Contradiction
  3. What Drives Them
  4. How to Read Them in Real Time
  5. What Shuts Them Down — And How to Recover
  6. How They Move from Interested to Committed
  7. The Dinner Party Test
- Section 2 (The Contradiction) names at least one usable tension the reader can work with in the room. If this section doesn't give the reader something to use, the profile fails.
- Section 3 (What Drives Them) contains a sentence explicitly flagged as the most important sentence in the profile — the single tactical insight the reader must hold above all others.
- Section 4 (How to Read Them in Real Time) uses evidence ceiling brackets when meeting behavior is inferred from institutional patterns rather than observed directly.
- Section 7 (The Dinner Party Test) covers: what bores them, what lights them up, how they move a room (or don't), and what they watch for in other people.
- Evidence ceiling brackets wherever the evidence can't support the section's analytical ambition.

## Output

The complete final Persuasion Profile. No commentary, no edit log, no explanation of changes. Just the profile.
`;

  return prompt;
}
