// Meeting Guide prompt builder — 5-layer architecture
// Layer 1: Meeting Guide Block v2 (voice specification)
// Layer 2: Exemplars (three canonical guides)
// Layer 3: Organization Reference Data (DTW org layer)
// Layer 4: Input Material (Persuasion Profile with transformation framing)
// Layer 5: Output Instructions (format/structure only)

export function buildMeetingGuidePrompt(
  donorName: string,
  profile: string,
  meetingGuideBlock: string,
  dtwOrgLayer: string,
  exemplars: string
): string {
  const currentDate = new Date();
  const monthYear = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // --- Layer 1: Meeting Guide Block v2 (full, unmodified) ---
  // --- Layer 2: Exemplars ---
  // --- Layer 3: Organization Reference Data ---
  // --- Layer 4: Input Material (Persuasion Profile) ---
  // --- Layer 5: Output Instructions ---

  return `${meetingGuideBlock}

---

${exemplars}

---

# ORGANIZATION REFERENCE DATA

${dtwOrgLayer}

---

# INPUT MATERIAL

The following is a Persuasion Profile — an analytical document about the donor. Your job is to transform this analysis into operational instructions for a live meeting. The profile's vocabulary, frameworks, and analytical language must not appear in your output. Translate every insight into what the reader will see in the room and what to do about it.

${profile}

---

# OUTPUT FORMAT AND STRUCTURE

Produce a Meeting Guide for ${donorName}. The current date is ${monthYear}.

Produce a Meeting Guide in the intermediate format shown in the exemplars. Use markdown with the following conventions. Do not produce HTML.

DOCUMENT HEADER:
MEETING GUIDE — [DONOR FULL NAME]
[Organization Name] · Opening Meeting · [Month Year]

Followed by a horizontal rule.

SECTION HEADERS use \`##\`:
THE DONOR READ
THE ALIGNMENT MAP
THE MEETING ARC
READING THE ROOM
RESET MOVES

SUBSECTION HEADERS use \`###\`:
POSTURE
WHAT LIGHTS THEM UP
WHAT SHUTS THEM DOWN
[THEY/SHE/HE]'LL WALK IN EXPECTING
THEIR INNER TRUTH
PRIMARY TERRITORY
SECONDARY TERRITORY 1 (through 3)
SETTING
ENERGY
BEAT 1 · GET THEM TALKING (through BEAT 5 · UNLOCK THE NETWORK)

POSTURE: Two to three paragraphs of prose. No bullets. Action-first — what to lead with in the first sentence, then why.

LIGHTS UP / SHUTS DOWN: Bulleted list, 4–5 items each. Each item: \`- **Bold imperative or trigger phrase.** Two to four sentences grounding it in this donor's specific behavioral logic.\`

WALK IN EXPECTING: One short paragraph. The default frame and exactly how to break it.

INNER TRUTH: Two to three paragraphs. The deeper contradiction and how to work within it.

PRIMARY TERRITORY: One to two paragraphs of prose. The specific overlap between the donor's named programs and the organization's actual work.

SECONDARY TERRITORIES: One paragraph each. Different angles into the same meeting, each connected to something specific in the donor's portfolio.

SETTING and ENERGY: One paragraph each. Separated by a horizontal rule from the beats.

BEATS: Five beats in sequence. Each beat uses this format:
BEAT [N] · [TITLE IN CAPS]
MOVE:
[Short paragraphs with generous white space between them. Not dense blocks.]
SIGNALS:
[ADVANCE] [What you see] | [What to do]
[HOLD] [What you see] | [What to do]
[ADJUST] [What you see] | [What to do]

Signal rows are one sentence each side of the pipe. Ordered: ADVANCE first, then HOLD, then ADJUST. Each beat should have 3–5 signal rows.

Beat titles follow this sequence unless the profile demands a different structure: GET THEM TALKING → LET THEM NAME THE STAKES → COMBINE YOUR WORLDS → PRESS PLAY → UNLOCK THE NETWORK.

Beats are separated by horizontal rules.

READING THE ROOM uses this format:
WORKING: [Short phrases separated by middle dots · ]
STALLING: [Short phrases separated by middle dots · ]

Six items each side. Observable behaviors specific to this donor.

RESET MOVES use this format:
[Condition in bold]
[What to do — one paragraph]
WHY: [What's driving this behavior and why the move works — one paragraph]

Three to four reset moves. Each one grounded in this donor's specific behavioral logic, not generic facilitation.

Horizontal rules (\`---\`) separate major sections: after the header, after THE DONOR READ, after THE ALIGNMENT MAP, between SETTING/ENERGY and the beats, between each beat, before READING THE ROOM, before RESET MOVES.`;
}
