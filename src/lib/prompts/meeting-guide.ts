// Meeting Guide prompt builder — 5-layer architecture (v3)
// Layer 1: Meeting Guide Block v3 (voice, register, choreography philosophy)
// Layer 2: Exemplars (2-3 canonical guides, excluding matching donor)
// Layer 3: Organization / Project Reference Data (user-supplied)
// Layer 4: Input Material (Persuasion Profile with transformation directive)
// Layer 5: Output Template (structural format with hard constraints)

export const MEETING_GUIDE_SYSTEM_PROMPT =
  'You are writing a meeting guide — a tactical briefing that tells a fundraiser exactly what to do in a live conversation with a specific donor. You receive five layers of input: a voice and standards spec, exemplar guides that demonstrate the target quality, organization reference data, the donor\'s persuasion profile, and an output template. Your job is to transform the analytical profile into operational instructions using the voice the spec defines and the structure the template requires. Every sentence must tell the reader what to do or what to watch for. If a sentence describes the donor without directing the reader, it hasn\'t been translated yet.';

export function buildMeetingGuidePrompt(
  donorName: string,
  profile: string,
  meetingGuideBlock: string,
  projectLayer: string,
  exemplars: string,
  outputTemplate: string,
  relationshipContext?: string,
): string {
  const currentDate = new Date();
  const monthYear = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // --- Layer 1: Meeting Guide Block v3 (full, unmodified) ---
  // --- Layer 2: Exemplars (2-3 guides, matching donor excluded) ---
  // --- Layer 3: Organization / Project Reference Data ---
  // --- Layer 4: Input Material (Persuasion Profile) ---
  // --- Layer 5: Output Template ---

  const relationshipBlock = relationshipContext?.trim()
    ? `\n\n---\n\n# FUNDRAISER'S PRIOR KNOWLEDGE\n\nThe fundraiser has provided the following context about their existing relationship with this donor. This is high-trust information from direct interaction. The meeting guide should build on this — if the fundraiser already knows the donor's communication style, the guide should deepen that knowledge rather than starting from zero.\n\n${relationshipContext}\n`
    : '';

  return `${meetingGuideBlock}

---

# EXEMPLAR GUIDES

The following are complete Meeting Guides at the target quality level. Study the voice, the register, the density, and the way every observation lands in an instruction. Your output must match this standard.

${exemplars}

---

# ORGANIZATION REFERENCE DATA

${projectLayer}

---

# INPUT MATERIAL

The following is a Persuasion Profile — an analytical document about the donor. Your job is to transform this analysis into operational instructions for a live meeting. Follow these rules:

1. The profile's vocabulary, frameworks, and analytical language must not appear in your output.
2. Translate every insight into what the reader will see in the room and what to do about it.
3. If the profile names a behavioral pattern, convert it to an if/then signal the reader can act on.
4. If the profile describes a value or motivation, convert it to a specific move — what to say, what to ask, what to avoid.
5. If the profile identifies a risk, convert it to a tripwire with an observable tell and a recovery move.
6. Every section of the profile should contribute to the guide, but no section should be restated — only translated.

${profile}${relationshipBlock}

---

# OUTPUT FORMAT AND STRUCTURE

${outputTemplate.replace('[DONOR NAME]', donorName).replace('[MONTH YEAR]', monthYear)}`;
}
