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

You are producing the final version of this Persuasion Profile. You have the Geoffrey Block (the voice standard), three exemplar profiles (the production standard), the original behavioral evidence, and the first draft. Your job is to turn the first draft into a profile that meets the exemplar standard.

## The Editorial Process

### Step 1: Score for insight novelty

Read the entire first draft. For each section, identify every major insight or behavioral claim.

Track each insight across the full document. The first time an insight appears with full analytical treatment, it scores highest. Every subsequent appearance of the same insight — restated in different words, applied to a slightly different context without doing genuinely new analytical work, or re-derived from a different angle — scores lower. By the third or fourth appearance, the score approaches zero.

Common patterns to catch:
- The same core thesis repeated across multiple sections in different language
- A quote deployed more than once
- A behavioral claim made in an early section and then restated (rather than extended) in a later section
- A section that is entirely composed of insights already fully deployed elsewhere

### Step 2: Score for tactical value

For each sentence, ask: does this change what the reader does in the meeting? Sentences that describe the donor without generating tactical intelligence for the reader score low. Sentences that tell the reader what to do, what to avoid, or what to watch for score high.

### Step 3: Produce the final version

Apply the scores. The final version should:

- **Cut** any sentence or passage that restates an insight already fully deployed in an earlier section. If the insight is relevant to the current section, convert it to a brief backward reference (one sentence or less) rather than a full re-derivation. Example: "The community-ownership architecture from section 2 governs this as well — the specific boundary here is..." rather than three sentences re-explaining community ownership.

- **Compress** any paragraph doing one sentence's worth of analytical work into that one sentence.

- **Smooth** transitions after cuts so sections read cleanly, not choppily.

- **Remove** duplicate quote deployments. A quote earns its space once. If the same quote appears in multiple sections, keep the strongest deployment and cut the others.

- **Preserve** the register. The Geoffrey Block voice must survive the editorial pass. Do not smooth the prose toward a more neutral or consultative register. The dry, compressed, tactical voice is the standard. If in doubt, reread the exemplars.

- **Preserve** the 18-section structure. All 18 sections must appear with their exact headings. Do not combine, rename, reorder, or remove sections. If cutting leaves a section with very little content, that is correct — a one-sentence section that holds the slot is better than a padded section that restates earlier insights.

- **Preserve** the structural requirements:
  - Section 4 (Where to Start) must name a usable contradiction
  - Section 5 (What Moves Them) must flag the most important sentence
  - Section 6 (How They Decide) must follow the three-stage structure
  - Evidence ceiling brackets must appear where evidence is thin

- **Add** evidence ceiling brackets where the first draft made claims the evidence doesn't support but failed to flag the gap. Check the extraction evidence — if a section's claims aren't grounded in the behavioral evidence provided, either bracket it or cut it.

## What this pass does NOT do

- Does not generate new behavioral analysis absent from the first draft
- Does not add new sections, subsections, or structural elements
- Does not change the analytical frame of any section (if the first draft analyzed trust as delegation, the final version analyzes trust as delegation — it doesn't reframe it as, say, trust as testing)
- Does not expand sections. This pass only maintains or reduces length. If you find yourself writing more than was in the first draft for any section, stop.
- Does not reorganize which insights appear in which sections. The insight stays in the section where the first draft placed it. The editorial pass removes redundant appearances elsewhere — it doesn't relocate them.

## Output

Produce the complete final Persuasion Profile. Title: \`# PERSUASION PROFILE — ${donorName.toUpperCase()}\`

The output is the final profile, not a commentary on the edits. Do not include any meta-commentary, editorial notes, change logs, or explanations of what was cut. Just the profile.
`;

  return prompt;
}
