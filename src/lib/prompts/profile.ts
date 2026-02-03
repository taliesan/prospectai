// Prompts for Step 3: Profile Generation

export const PROFILE_SECTIONS = [
  { number: 1, title: 'Donor Identity & Background', focus: 'Formation, institutional imprint, class/geography, formative ruptures, mentors, political inheritance' },
  { number: 2, title: 'Core Motivations, Values & Triggers', focus: 'Worldview, incentives, ideological tension, personal stakes, central contradiction' },
  { number: 3, title: 'Ideal Engagement Style', focus: 'How to enter their cognitive channel: tone, pacing, critique bandwidth, co-design tolerance' },
  { number: 4, title: 'Challenges & Risk Factors', focus: 'Rupture risks: ego shape, ghost patterns, authorship fears, defensiveness patterns' },
  { number: 5, title: 'Strategic Opportunities for Alignment', focus: 'Openings, authorship lanes, contradiction-based inflection points' },
  { number: 6, title: 'Tactical Approach to the Meeting', focus: 'Emotional opener, mid-pitch pivot, authorship trigger, follow-up path' },
  { number: 7, title: 'Dinner Party Test', focus: 'Unmoderated cognition: social physics, curiosity, boredom thresholds, trust cues' },
];

export const PROFILE_GENERATION_PROMPT = `You are generating a DTW-grade donor persuasion profile.

CRITICAL PRINCIPLES (from the canon):

1. BEHAVIORAL, NOT BIOGRAPHICAL
Every bullet must describe BEHAVIOR - how they move under pressure, not who they are.
Wrong: "Values collaboration"
Right: "When someone offers to co-design, he tests their commitment by introducing a constraint. If they adjust, he invests; if they defend their original frame, he classifies them as inflexible."

2. CONDITIONAL LOGIC
Every bullet must contain conditional structure: when X, they do Y.
Wrong: "Is thoughtful and strategic"
Right: "When the conversation stays abstract, she redirects to specific examples. If the counterpart can't provide them, she shifts into evaluation mode."

3. SPECIFICITY (THE NAME-SWAP TEST)
Every bullet must be so specific that swapping in a different donor's name would make it obviously false.
Wrong: "Cares about worker rights" (could be anyone)
Right: "His core contradiction is transparency vs. exposure - he prefers to be open even when vulnerable, but expects reciprocity. When someone names their own uncertainty, he engages fully. When someone performs vulnerability without stakes, he shuts the door quietly."

4. CONTRADICTIONS ARE CENTRAL
The profile MUST surface at least one substantive contradiction - tension between stated values and revealed behavior. This is where persuasion lives.

5. RETREAT PATTERNS MUST BE EXPLICIT
I must know how this donor signals disengagement and what triggers it. Without this, the profile fails its core purpose.

6. ACTIONABLE
Every bullet must imply a consequence for the asker - what to do or avoid.

THE SEVEN SECTIONS:

1. Donor Identity & Background
Reveal formation: institutional imprint, class/geography, formative ruptures, failures, mentors.
Outcome: The asker can model the donor's posture in three sentences.

2. Core Motivations, Values & Triggers
Clarify what frames their yes/no: worldview, incentives, tension, personal stakes, contradiction.
Outcome: The asker can anticipate their emotional pivot under pressure.

3. Ideal Engagement Style
Describe how to enter their cognitive channel: tone, pacing, co-design tolerance.
Outcome: The asker knows how to show up without breaking chemistry.

4. Challenges & Risk Factors
Surface rupture risks: ego shape, defensiveness patterns, authorship fears.
Outcome: The asker avoids the three most likely meeting failures.

5. Strategic Opportunities for Alignment
Translate psychology into leverage: openings, authorship lanes, contradiction-based inflection points.
Outcome: The strategist knows which doors the donor will open - and under what conditions.

6. Tactical Approach to the Meeting
Provide the emotional opener, mid-pitch pivot, authorship trigger, and follow-up path.
Outcome: The asker can run the entire conversation from this section alone.

7. Dinner Party Test
Model unmoderated cognition: social physics, curiosity, boredom thresholds, trust cues.
Outcome: The asker avoids tone errors in informal but politically meaningful rooms.

FORMAT:

Use bullets (●) only - no paragraphs, no numbered lists within sections.
Each bullet should be 2-5 sentences - substantial but not bloated.
Use the donor's pronouns consistently (he/she/they).
No meta-commentary ("This section covers...").
No generic advice that could apply to anyone.

OUTPUT:

Generate a complete 7-section profile. Each section should have 3-6 bullets.
The profile should feel like it was written by someone who has sat in rooms with this donor.`;

export function createProfilePrompt(donorName: string, dossier: string, exemplars: string): string {
  return `${PROFILE_GENERATION_PROMPT}

---

DONOR: ${donorName}

BEHAVIORAL DOSSIER:
${dossier}

---

EXEMPLAR PROFILES (for quality reference):
${exemplars}

---

Generate the complete 7-section persuasion profile for ${donorName}.

The profile must:
- Be grounded entirely in the dossier evidence
- Match the quality and specificity of the exemplars
- Be behavioral, conditional, and actionable throughout
- Surface the core contradiction
- Make retreat patterns explicit

Begin with "## 1. Donor Identity & Background" and continue through all seven sections.`;
}

export function createRegenerationPrompt(donorName: string, dossier: string, exemplars: string, previousDraft: string, critique: string): string {
  return `${PROFILE_GENERATION_PROMPT}

---

DONOR: ${donorName}

BEHAVIORAL DOSSIER:
${dossier}

---

EXEMPLAR PROFILES (for quality reference):
${exemplars}

---

PREVIOUS DRAFT:
${previousDraft}

---

VALIDATION CRITIQUE:
${critique}

---

The previous draft failed validation. The critique above identifies what was wrong.

Regenerate the profile, specifically addressing the critique. The new version must fix the identified issues while maintaining everything that was working.

Begin with "## 1. Donor Identity & Background" and continue through all seven sections.`;
}
