import type { LinkedInData } from './extraction-prompt';
import { loadPromptV2 } from '../canon/loader';

export function buildProfilePrompt(
  donorName: string,
  extractionOutput: string,
  geoffreyBlock: string,
  exemplars: string,
  linkedinData?: LinkedInData | null
): string {
  const promptVersion = process.env.PROMPT_VERSION || 'v2';

  if (promptVersion === 'v2') {
    const template = loadPromptV2();

    // Build canonical bio section from linkedinData
    let canonicalBio = '';
    if (linkedinData) {
      canonicalBio = `**Current Position:** ${linkedinData.currentTitle} at ${linkedinData.currentEmployer}

**Career History:**
${linkedinData.careerHistory.map(job =>
  `- ${job.title} at ${job.employer} (${job.startDate} - ${job.endDate})`
).join('\n')}

**Education:**
${linkedinData.education.map(edu =>
  `- ${edu.institution}${edu.degree ? `: ${edu.degree}` : ''}${edu.field ? ` in ${edu.field}` : ''}${edu.years ? ` (${edu.years})` : ''}`
).join('\n')}

${linkedinData.boards?.length ? `**Board/Advisory Roles:**\n${linkedinData.boards.map(b => `- ${b}`).join('\n')}` : ''}`;
    } else {
      canonicalBio = 'No canonical biographical data available.';
    }

    // Two marker replacements
    let assembled = template
      .replace('[PIPELINE INJECTS CANONICAL BIO HERE]', canonicalBio)
      .replace('[PIPELINE INJECTS BEHAVIORAL DOSSIER HERE]', extractionOutput);

    // Replace [TARGET NAME] with actual donor name
    assembled = assembled.replaceAll('[TARGET NAME]', donorName);

    return assembled;
  }

  // V1: original 5-layer assembly
  // --- Layer 1: Geoffrey Block v2 (full, unmodified) ---
  const layer1 = geoffreyBlock;

  // --- Layer 2: Exemplar Profiles + Contamination Fence ---
  const layer2 = `---

${exemplars}

═══════════════════════════════════════════════════════════════════════
⛔ EXEMPLAR ZONE — END ⛔
═══════════════════════════════════════════════════════════════════════

CONTAMINATION RULES — HARD ENFORCEMENT:

1. Every FACT in your output must trace to the research dossier below
   or to the canonical biographical data. If it's not there, it cannot
   appear in the profile. No exceptions.

2. Every QUOTE in your output must come from a source about THIS target.
   If Craig Newmark said it, it stays with Newmark. If Roy Bahat said
   it, it stays with Bahat. If Lori McGlinchey said it, it stays with
   McGlinchey.

3. Every INSTITUTIONAL AFFILIATION (board seats, roundtables, committee
   memberships, fellowships) must appear in either the LinkedIn data or
   a cited source URL. The exemplar donors sit on different boards than
   your target. Do not import their affiliations.

4. Before writing each bolded assertion, ask: "Where in the research
   dossier is the evidence for this?" If you cannot point to it, do
   not write the assertion.

The exemplars taught you how to write. The dossier tells you what to
write. These are different jobs. Do not confuse them.
═══════════════════════════════════════════════════════════════════════`;

  // --- Layer 3: Canonical Biographical Data (only if linkedinData exists) ---
  let layer3 = '';
  if (linkedinData) {
    layer3 = `
---

# CANONICAL BIOGRAPHICAL DATA

Use this as the authoritative source for biographical facts in the Operating System section.

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
    ? `This donor has a substantial public record including direct quotes and first-person statements. Deploy quotes as behavioral proof — the profile makes a claim, then a quote demonstrates it. Do not let quotes drive the structure. The behavioral inference drives the structure; quotes prove it. What they said, what they built, how they structured their work, and what they advocated for — these are the source material for behavioral inference.`
    : `This donor operates primarily through institutional channels. Their public record consists mainly of blog posts, published frameworks, organizational strategy documents, and career moves. What they wrote, what they built, how they structured their work, and what they advocated for — these are the source material for behavioral inference. Grant architecture is behavioral evidence. Published methodology is behavioral evidence. Career pattern is behavioral evidence.`;

  const donorNameCaps = donorName.toUpperCase();

  const layer5 = `---

# OUTPUT INSTRUCTIONS

Write a Persuasion Profile for ${donorName}.

## Structure (non-negotiable)

Title the document: \`# PERSUASION PROFILE — ${donorNameCaps}\`

The profile has exactly 7 sections in exactly this order with exactly these headings:

1. ## 1. THE OPERATING SYSTEM
2. ## 2. THE CONTRADICTION
3. ## 3. WHAT DRIVES THEM
4. ## 4. HOW TO READ THEM IN REAL TIME
5. ## 5. WHAT SHUTS THEM DOWN — AND HOW TO RECOVER
6. ## 6. HOW THEY MOVE FROM INTERESTED TO COMMITTED
7. ## 7. THE DINNER PARTY TEST

All 7 sections must appear. Do not combine sections. Do not rename sections. Do not reorder sections. Do not add sections. Separate sections with a horizontal rule (---).

## What each section does

1. **THE OPERATING SYSTEM** — Who this person is at the level that generates behavior. Formation, institutional imprint, the identity that runs underneath everything else. The reader finishes this section able to model the donor's posture before the meeting starts. Resume facts earn their space only when they generate behavioral inference — biographical detail without behavioral payoff is filler.

2. **THE CONTRADICTION** — The place where who they believe they are, how they see the world, and what they're incentivized to do don't fully line up. Every donor has at least one. Name it, show how it works, and tell the reader what to do about it. If this section doesn't give the reader a tension they can use in the room, the profile fails.

3. **WHAT DRIVES THEM** — Values hierarchy, what activates them, what they fund and why. This section must contain a sentence explicitly flagged as the most important sentence in the profile — the single tactical insight the reader must hold above all others. This section also carries the field-building or resource philosophy material — how they think about what money can and can't do, what kind of work they fund, and what shape an ask needs to take.

4. **HOW TO READ THEM IN REAL TIME** — Meeting behavior: verbal tells, energy signals, engagement markers, disengagement markers. What the reader watches for and what it means. Behavioral forks belong here — the if/then pairs that tell the reader what to do when the meeting goes one way versus another. When the evidence can't support real-time behavioral claims (because no one has observed this person in meetings), say so with an evidence ceiling bracket and give the reader institutional-pattern inferences instead.

5. **WHAT SHUTS THEM DOWN — AND HOW TO RECOVER** — Triggers, defensive motion, hard limits, and recovery paths. The reader knows the most likely meeting failures and what to do about each one. Triggers should be ordered by severity. Recovery guidance should be specific — not "rebuild trust" but what the reader actually does next.

6. **HOW THEY MOVE FROM INTERESTED TO COMMITTED** — The trust pathway, commitment pattern, and what the commitment looks like when it arrives. How the reader gets from a first meeting to a real relationship. What accelerates the process, what stalls it, and what the donor's commitment history tells you about duration, scale, and conditions.

7. **THE DINNER PARTY TEST** — Four beats: what bores them, what lights them up, how they move a room (or don't), and what they watch for in other people. This is the personality layer — the section the reader re-reads in the car before walking in.

## Evidence class

${evidenceClassBlock}

When the source record can't support a section's full analytical ambition — when you have no data on someone's verbal style in meetings, their listening patterns, or their retreat tells — flag it. A bracketed evidence ceiling note tells the reader what the profile can and can't do: *[Evidence ceiling: Zero data on X. Both observations above are inferred from Y.]* This is better than guessing. The reader adjusts their preparation accordingly.

## Writing principles

- The profile is a briefing, not an essay. The reader is prepping for a meeting, not admiring the writing. If a sentence sounds like it's trying to be good prose, it's doing the wrong job. Write like you're talking to a colleague who has a meeting tomorrow. Not casual, not sloppy — but direct, warm, and talking to a person.
- The read-aloud test. Read the sentence out loud. If it sounds like something you'd say to a smart colleague over coffee, it passes. If it sounds like something you'd write in a report, rewrite it.
- An insight earns its space once. The first time it appears, give it full treatment. If it's relevant to a later section, trust the reader to hold it. Do not re-derive the same insight in different words.
- Section length follows evidence density. A section with one paragraph is correct if that's all the evidence supports. A section with four paragraphs is correct if the evidence supports four paragraphs of non-redundant behavioral analysis. The seven sections are load-bearing — every sentence in every section must change what the reader does in the meeting.
- No methodology vocabulary in the output. Terms like "permission structure," "governing diagnosis," "trust calibration," and "substrate reconstruction" are internal vocabulary from the Block and the exemplars. They help you think. They cannot appear in the profile. If a term from the Block shows up in your output, you've delivered the scaffolding instead of the building.
- No literary construction. If a sentence sounds like it's trying to be clever — mirrored parallelism ("The modesty is genuine. So is the scale."), flowchart arrows, compressed aphorisms that require unpacking — rewrite it until it just says the thing. The most common failure mode: the model writes a sentence that sounds impressive on the page but doesn't say anything the reader can use. Every sentence must pass the test: what does the reader do with this in the meeting?
- Bolded assertions must be traceable to evidence. Every bolded claim in the profile should connect to something in the behavioral evidence or the canonical biographical data. Bold signals "this is load-bearing" — if the evidence doesn't support the weight, don't bold it.
- Donor quotes ground claims — they don't decorate. A quote appears because the analysis that follows unpacks what the quote reveals behaviorally. If the quote doesn't set up an insight the reader needs, it's filler. If the insight could stand without the quote, the quote is redundant.
- Conditional structure in behavioral claims. When X happens, they do Y. If you bring A, expect B. This is how the reader translates the profile into meeting behavior.
- Specific enough to fail the name-swap test. If you swap in a different donor's name and the sentence still reads as true, the sentence is too generic. Cut it or sharpen it.`;

  // Assemble all five layers
  return `${layer1}
${layer2}
${layer3}
${layer4}

${layer5}`;
}
