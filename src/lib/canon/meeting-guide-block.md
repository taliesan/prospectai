# Meeting Guide Block — Voice, Standards, Register

## Register

Every sentence in a Meeting Guide must pass these transformations. The left column is what the model defaults to. The right column is what this work requires. If your sentence matches the left column, rewrite it until it matches the right.

**Profile voice → Guide voice.**
- ❌ "When someone frames her as a tech policy expert, she widens the aperture."
- ✅ "They'll widen the aperture. Follow them. Don't try to narrow it back."

**Donor description → Reader instruction.**
- ❌ "She values transparency and directness in conversation."
- ✅ "Match her pace. If you hedge, she reads weakness."

**Trait observation → Conditional read.**
- ❌ "He's analytical and likes to think through problems carefully."
- ✅ "If he starts redesigning your model out loud, stop talking. He's inside the frame."

**General advice → Specific move.**
- ❌ "Build rapport before discussing the ask."
- ✅ "Don't open with your material. Frame it as shared work: 'We're wrestling with something and want to think it through with you.'"

**Passive observation → Active signal.**
- ❌ "She tends to engage more deeply when intellectually stimulated."
- ✅ "If she starts riffing — making connections out loud she hasn't made before — that's her highest engagement mode. Don't interrupt."

**Personality summary → Behavioral tripwire.**
- ❌ "She doesn't respond well to flattery."
- ✅ "Flattery triggers pattern recognition. She's been licked up and down by billionaires. She'll classify you as a pitch and the meeting is over."

**Strategic suggestion → Operational command.**
- ❌ "Consider positioning the work as aligned with her existing interests."
- ✅ "Name the gap in her ecosystem she hasn't filled. Let her place you in it."

**Vague framing → Concrete move.**
- ❌ "Help them see the stakes in their own terms."
- ✅ "Ask what happens to workers in his portfolio companies' industries if organizing infrastructure doesn't exist in five years. Don't say 'movement.' Don't say 'justice.' Let him arrive at the stakes in his own language."

**Outcome description → Room choreography.**
- ❌ "The goal is to establish a collaborative dynamic."
- ✅ "When she starts naming people you should meet, she's shifting from prosecutor to patron. Write names down visibly. That's a commitment."

**Soft close → Sharp vector.**
- ❌ "End by expressing interest in continuing the conversation."
- ✅ "Don't summarize the meeting. She heard herself. If she proposes a next step, take it immediately — she's telling you how she commits."

**Issue alignment → Ecosystem leverage.**
- ❌ "She cares about tech accountability and worker rights align with that."
- ✅ "She funds civil society infrastructure to challenge tech power from the outside. DTW builds worker power inside the same companies. This is the inside game to her outside game."

**Role description → Function assignment.**
- ❌ "She could serve as an advisor or connector."
- ✅ "Connector, amplifier, and source consumer. She wants to know who you need to reach and what's happening in your world that she should know about."

---

## Voice and Tone

Write as a strategist briefing an operator before a live performance. The reader should feel like they're being handed a weapon by someone who has been in the room with this donor, not someone who analyzed them from a distance.

Second person imperative. The reader is "you." Direct commands: "Ask what she's seeing." "Don't fill the silence." "Write names down visibly." Never "one might consider" or "it could be useful to."

Third person for the donor, pronouns only after the POSTURE paragraph. The document should feel like a briefing about someone the reader already knows by name.

Present tense for behavioral claims. Past tense only for biographical facts that explain current behavior.

Conditional structure for every read: "If X, they're doing Y. Do Z."

Dry. Operational. No admiration, no warmth, no sentiment. No hedge language — "probably," "might," "could consider" all fail. If certainty isn't warranted, rewrite as a conditional.

---

## What to Avoid

- Profile language ("She tends to..." / "He is known for..." / "They value...")
- Hedge words ("probably," "might," "could consider")
- Generic advice that could apply to any donor ("Build trust first" / "Establish rapport")
- Meta-commentary ("This section covers..." / "The key insight here is...")
- Sentences that describe without directing action
- Issue alignment without ecosystem logic ("She cares about X and you do X")
- Any line that passes the name-swap test — if you swap in a different donor and it still works, delete it

---

## Structure

Four components. Each one load-bearing — if a component doesn't change how the reader moves in the room, it fails.

**THE DONOR READ** — Load the reader with the donor's operating system in 90 seconds. Posture, hooks, tripwires, default frame, authorship need, five-minute fallback. If the POSTURE doesn't tell the reader what kind of meeting this is in two sentences, the section fails. If WHAT LIGHTS THEM UP could apply to a different donor, the section fails.

**THE ALIGNMENT MAP** — Where the donor's world meets the organization's work. Primary territory, secondary territories, fight-or-build orientation, hands-on-the-wheel role. If PRIMARY TERRITORY reads as issue alignment instead of ecosystem leverage, the section fails. If HANDS ON THE WHEEL describes a title instead of a function, the section fails.

**THE MEETING ARC** — Five moves in sequence. Each move has an instruction column (what to do) and a read column (what their response means). The opening italic paragraph must set venue, small talk strategy, governing frame, and register notes. If the five moves could be scrambled without loss, the arc fails. If THE READ column doesn't use conditional structure, the arc fails. The reader runs the entire meeting from this section.

**READING THE ROOM** — Signal dictionary. Working vs. stalling indicators. Three reset moves for when presence fades. If WORKING and STALLING don't name observable behaviors specific to this donor, the section fails. If RESET MOVES are generic facilitation techniques instead of moves grounded in this donor's behavioral logic, the section fails.

---

## Language Standards

- Bullets are 2-4 sentences. Dense but not bloated.
- Table cells are one dense paragraph, not multiple paragraphs.
- Pronouns consistent throughout — donor's name appears in header and POSTURE only.
- Specific enough to fail the name-swap test: if you swap in a different donor and it still reads as true, delete it.
- Conditional structure in every behavioral read: if X happens, they're doing Y.
- Reset moves must be explicit: condition, move, rationale.

---

## Choreography Philosophy

This is not a compressed Profile. Not a research summary. Not generic fundraising advice dressed in donor-specific clothing. It's a cue card with teeth — stage directions for a live performance where the reader improvises within structure.

The Meeting Guide doesn't describe who the donor is. It tells the reader what to do about who the donor is — minute by minute, signal by signal, reset by reset.

The reader picks this up before the meeting. When they put it down, they walk into the room, read the donor's behavior in real time, and adjust without looking at their notes. The document is a rehearsal, not a reference.

A Meeting Guide is always written for a specific donor × specific organization pairing. The same donor meeting a different organization produces a different Guide. If you could swap in a different org and the Guide still works, it's too generic.

---

## Implementation

This block goes into the generation prompt before the exemplars. It tells the model how Meeting Guides sound before it sees examples.

The exemplars reinforce what this block establishes. They do not compete with it.

If the model produces output that matches the ❌ column in the Register section, the output fails regardless of what the exemplars show.
