// Prompts for Meeting Guide generation

export const MEETING_GUIDE_PROMPT = `You are generating a Meeting Guide for a fundraising meeting.

## INPUTS

**Persuasion Profile:**
The completed 18-section behavioral profile for this donor is provided below. This tells you how the donor moves under pressure — what triggers engagement, what causes withdrawal, how they signal commitment, how they retreat.

**Organization Layer:**
The asking organization's mission, theory of change, portfolio, and values are provided below. This shapes what you're asking for, where alignment lives, and what vocabulary to use.

**Your Task:**
Translate the Profile's behavioral insights into choreography for a meeting where this organization is the asker. Every recommendation must be specific to this donor × this organization intersection.

## OUTPUT FORMAT

\`\`\`
# MEETING GUIDE — [DONOR FULL NAME]
*Democracy Takes Work · [Month Year] · Internal Use Only*
---
## THE DONOR READ
**POSTURE**
**[Bold behavioral thesis — 1-2 sentences stating what kind of meeting this is.]**
[Operational paragraph: how to arrive, what to bring, what register to adopt, whether to bring a shared contact. Length varies by donor.]

**WHAT LIGHTS THEM UP**
- **[Bolded imperative clause.]**
  [2-4 sentences explaining why this works, grounded in this donor's specific behavioral logic.]
- [3 more bullets, same format]

**WHAT SHUTS THEM DOWN**
- **[Bolded noun phrase or sentence naming the trigger.]**
  [1-3 sentences explaining the consequence — the mode they shift into and why recovery is hard.]
- [3 more bullets, same format]

---

**THEY'LL READ YOU AS** · [One sentence naming the default frame. Then 2-3 sentences on how to break it in 90 seconds.]

**AUTHORSHIP THEY NEED** · [What role they need to play. 2-3 sentences of operational guidance.]

**IF THIS COLLAPSES TO 5 MIN:** *[Italicized. One compressed paragraph. The single move that lands a vector. Must end with a clear next step.]*

---
## THE ALIGNMENT MAP
**PRIMARY TERRITORY**
**[Bold thesis statement naming the core alignment in ecosystem/portfolio logic, not issue overlap.]**
[Paragraph unpacking why this alignment is structural, not cosmetic. What the donor brings, what it connects to, why it's live.]

**SECONDARY TERRITORIES**
- **[Bolded label for the territory.]**
  [3-5 sentences connecting to something specific in the donor's portfolio, history, or stated commitments. Not a backup pitch — a flanking position.]
- [2 more bullets, same format]

**FIGHT OR BUILD** · **[Bold declaration: "Open Fight." or "Open Build." or "Build that challenges power."]** [2-3 sentences on who initiates, who follows, when to switch frames.]

**HANDS ON THE WHEEL** · **[Bold phrase naming the function, not a title.]** [2-3 sentences on what the highest-value next step actually is — often not money.]

---
## THE MEETING ARC
*[Italic opening paragraph. Venue strategy. Small talk strategy. Governing frame for the interaction. Critical register notes. What to do if time gets short. This paragraph does heavy tactical work.]*

| THE MOVE | THE READ |
|----------|----------|
| **1 · GET THEM TALKING** | |
| **[Opening instruction. What to ask or say to get them into their own material. May include specific language in quotes.]** | [Conditional reads: what presence vs. screening looks like. If/then structure.] |
| **2 · LET THEM NAME THE STAKES** | |
| **[Guide them to articulate the problem in their own language. Explicit instruction not to use your vocabulary. Include "Then wait. Don't fill the silence."]** | [What their language reveals. What vocabulary to adopt.] |
| **3 · COMBINE YOUR WORLDS** | |
| **[Bridge from their framing. Credit their language. Share real constraints. Put something between you — a map, a document. Make money part of the shared design, not a separate ask.]** | [What signals they've moved from evaluating to building. What co-creation looks like with this donor.] |
| **4 · PRESS PLAY** | |
| **[Convert to next step. Tailored to how this donor commits — all at once, gradually, experientially. Specific example of what to propose.]** | [What their proposed next step reveals. What to do if they're still in design mode.] |
| **5 · UNLOCK THE NETWORK** | |
| **['Who else should be seeing what we're seeing?' Be specific — name a domain. 'Write names down visibly — on paper between you.']** | [Why unprompted introductions are commitment. Follow-up timing.] |

---
## READING THE ROOM
| WORKING | STALLING |
|---------|----------|
| [Observable behaviors. Short phrases. "Using 'we.'" "Naming specific people." "Getting genuinely angry."] | [Observable behaviors. Short phrases. "Googleable questions." "Pleasant but flat." "Wrapping-up tone."] |

**RESET MOVES**
- **[Condition.]** [Move — concrete and immediate.] [Rationale — why it works for this donor.]
- [2 more bullets, same format]

---
*CONFIDENTIAL · ProspectAI · Generated from Persuasion Profile + DTW Mandate + Fundraising Canon*
\`\`\`

## CRITICAL RULES

- Every line must fail the name-swap test. If you swap in a different donor and it still reads as true, rewrite it.
- Second person imperative for instructions. "Ask what she's seeing." "Don't fill the silence."
- Third person pronouns for the donor after the POSTURE paragraph. No repeated use of their name.
- Conditional structure for reads: "If X, they're doing Y."
- No hedge language. No "probably," "might," "could consider."
- No generic fundraising advice. Every instruction traces to this donor's behavioral logic and this organization's position.
- The reader glances at this document mid-meeting. They find what they need in 3 seconds.
- Compression: bullets are 2-4 sentences. Dense but not bloated.`;

export function buildMeetingGuidePrompt(
  donorName: string,
  profile: string,
  meetingGuideBlock: string,
  dtwOrgLayer: string,
  exemplars: string
): string {
  const currentDate = new Date();
  const monthYear = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return `${meetingGuideBlock}

---

## ORGANIZATION LAYER

${dtwOrgLayer}

---

## PERSUASION PROFILE FOR ${donorName.toUpperCase()}

${profile}

---

## EXEMPLARS

The following Meeting Guides demonstrate the voice, structure, and quality standard:

${exemplars}

---

## YOUR TASK

Generate a Meeting Guide for ${donorName} following the format and standards above. The current date is ${monthYear}.

${MEETING_GUIDE_PROMPT}`;
}
