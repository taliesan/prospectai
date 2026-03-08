// Prompts for Profile Validation

export const VALIDATION_PROMPT = `You are validating a donor persuasion profile against the A+++ standard.

Your job is to identify gaps between this profile and the standard. You have the canon (how to think), the exemplars (what good looks like), and the research package (the evidence base).

VALIDATION CRITERIA:

1. BEHAVIORAL FOCUS
Every bullet must describe behavior, not traits.
- FAIL: "Is thoughtful and values-driven"
- PASS: "When someone presents a polished narrative, she probes for the messy parts. If they can't name them, she classifies the pitch as unserious."

Check: Does every bullet describe HOW they behave, not WHO they are?

2. SPECIFICITY (Name-Swap Test)
Every bullet must be specific to THIS donor.
- FAIL: "Cares about social justice" (could be anyone)
- PASS: "His core contradiction is that he built wealth in a system he now critiques - he navigates this by funding structural change while avoiding personal exposure."

Check: If you swapped in a different donor's name, would the bullet become obviously false?

3. CONDITIONAL LOGIC
Every bullet must contain conditional structure.
- FAIL: "Values transparency"
- PASS: "When someone admits uncertainty early, he relaxes and shifts into co-design mode. When they perform confidence, he becomes evaluative."

Check: Does every bullet have "when/if/under pressure" structure?

4. CONTRADICTION PRESENT
The profile MUST surface at least one substantive contradiction - tension between stated values and revealed behavior.

Check: Is there a clear, specific contradiction that creates leverage?

5. EVIDENCE GROUNDING
Every claim must trace to the research package. No hallucinated insights.

Check: Could you point to specific research package evidence for each major claim?

6. ACTIONABILITY
Every bullet must imply a consequence for the asker.

Check: After reading each bullet, does the asker know what to DO differently?

7. CANON COMPLIANCE
Does this match the quality of the exemplars? Does it feel like the same standard?

Check: Could this profile sit alongside Roy Bahat or Leah Hunt-Hendrix without embarrassment?

---

VALIDATION PROCESS:

Read the profile carefully.
Compare each section against the criteria.
Compare the overall quality against the exemplars.

If ALL criteria are met: Output "PASS"

If ANY criteria fail: Output a specific critique that tells the generator exactly what to fix.

CRITIQUE FORMAT:
Be specific. Name the failing criterion. Quote the problematic text. Explain what's wrong. Suggest what would fix it.

Good critique: "FAIL - Specificity. Section 2, bullet 3 ('cares deeply about democracy') is generic and could apply to dozens of donors. This needs to be replaced with something specific to how THIS donor thinks about democracy - what's their particular theory, what contradictions do they hold?"

Bad critique: "Some parts could be more specific" (too vague to act on)

---

Remember: You're not being harsh for its own sake. You're protecting the user from walking into a meeting with a useless profile. Be rigorous.`;

export function createValidationPrompt(donorName: string, researchPackage: string, exemplars: string, profile: string): string {
  return `${VALIDATION_PROMPT}

---

DONOR: ${donorName}

RESEARCH PACKAGE (evidence base):
${researchPackage.slice(0, 20000)}
${researchPackage.length > 20000 ? '\n[Research package truncated for validation...]' : ''}

---

EXEMPLAR PROFILES (the quality standard):
${exemplars}

---

PROFILE TO VALIDATE:
${profile}

---

Validate this profile against the A+++ standard. Output either "PASS" or a specific critique.`;
}
