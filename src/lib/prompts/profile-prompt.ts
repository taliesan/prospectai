import type { LinkedInData } from './extraction-prompt';

export function buildProfilePrompt(
  donorName: string,
  extractionOutput: string,
  geoffreyBlock: string,
  exemplars: string,
  linkedinData?: LinkedInData | null
): string {
  // --- Layer 1: Geoffrey Block v2 (full, unmodified) ---
  const layer1 = geoffreyBlock;

  // --- Layer 2: Exemplar Profiles ---
  const layer2 = `---

${exemplars}`;

  // --- Layer 3: Canonical Biographical Data (only if linkedinData exists) ---
  let layer3 = '';
  if (linkedinData) {
    layer3 = `
---

# CANONICAL BIOGRAPHICAL DATA

Use this as the authoritative source for biographical facts in the Life & Career section.

**Current Position:** ${linkedinData.currentTitle} at ${linkedinData.currentEmployer}

**Career History:**
${linkedinData.careerHistory.map(job =>
  `- ${job.title} at ${job.employer} (${job.startDate} - ${job.endDate})`
).join('\n')}

**Education:**
${linkedinData.education.map(edu =>
  `- ${edu.institution}${edu.degree ? `: ${edu.degree}` : ''}${edu.field ? ` in ${edu.field}` : ''}${edu.years ? ` (${edu.years})` : ''}`
).join('\n')}

${linkedinData.boards?.length ? `**Board/Advisory Roles:**\n${linkedinData.boards.map(b => `- ${b}`).join('\n')}` : ''}
`;
  }

  // --- Layer 4: Behavioral Evidence ---
  const layer4 = `---

# BEHAVIORAL EVIDENCE

The following behavioral evidence was extracted from research sources about ${donorName}. Use it as raw material — quotes are proof for behavioral claims, not content to be restated. Make behavioral inferences from the evidence. Do not summarize the evidence.

${extractionOutput}`;

  // --- Layer 5: Output Instructions ---
  // Evidence class selection
  const firstPersonQuotes = (extractionOutput.match(/"[^"]*\b(I|we)\b[^"]*"/gi) || []).length;
  const evidenceClass = firstPersonQuotes >= 5 ? 'A' : 'B';

  const evidenceClassBlock = evidenceClass === 'A'
    ? `This donor has a substantial public record including direct quotes and first-person statements. Deploy quotes as behavioral proof — the profile makes a claim, then a quote demonstrates it. Do not let quotes drive the structure. The behavioral inference drives the structure; quotes prove it.`
    : `This donor operates primarily through institutional channels. Their public record consists mainly of press releases, grant announcements, governance positions, and program design decisions. Grant architecture is behavioral evidence. Governance choices are behavioral evidence. Program design is behavioral evidence. What they funded, how they structured it, who they convened, and what they didn't fund — these are the source material for behavioral inference.`;

  const donorNameCaps = donorName.toUpperCase();

  const layer5 = `---

# OUTPUT INSTRUCTIONS

Write a Persuasion Profile for ${donorName}.

## Structure (non-negotiable)

Title the document: \`# PERSUASION PROFILE — ${donorNameCaps}\`

The profile has exactly 18 sections in exactly this order with exactly these headings:

1. ## Life and Career
2. ## Who They Think They Are
3. ## What They Value Most
4. ## Where to Start
5. ## What Moves Them
6. ## How They Decide
7. ## How They Build Trust
8. ## What Sets Them Off
9. ## Where They Draw Lines
10. ## How They Communicate
11. ## How They Commit
12. ## How They Think About Resources
13. ## What They'll Risk
14. ## How They Build Relationships
15. ## How They Think About Time
16. ## How They Read Status
17. ## How They Learn
18. ## What They Know

All 18 sections must appear. Do not combine sections. Do not rename sections. Do not reorder sections. Do not add sections.

## Evidence class

${evidenceClassBlock}

## Writing principles

- An insight earns its space once. The first time it appears, give it full treatment. If it's relevant to a later section, reference it or trust the reader to hold it. Do not re-derive the same insight in different words.
- Section length follows evidence density. A section with one sentence is correct if that sentence is the only new thing to say. A section with three paragraphs is correct if the evidence supports three paragraphs of non-redundant behavioral analysis.
- When the evidence can't support a section's analytical ambition, say so. Use an evidence ceiling bracket: **[Evidence ceiling: description of what data is missing and what the above observations are inferred from.]**
- Section 5 (What Moves Them) must contain a sentence explicitly flagged as the most important sentence in the profile — the single tactical instruction the reader must hold above all others.
- Section 4 (Where to Start) must name at least one usable contradiction. If this section doesn't give the reader a tension they can use in the room, the profile fails.
- Section 6 (How They Decide) must follow the three-stage structure: entry condition, permission logic, behavioral commitment.`;

  // Assemble all five layers
  return `${layer1}
${layer2}
${layer3}
${layer4}

${layer5}`;
}
