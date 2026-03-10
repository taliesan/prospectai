// Professor review — separate Opus API call that critiques a first draft
// against the full profiling canon. Runs in its own context window with
// no access to research sources or exemplars.

import Anthropic from '@anthropic-ai/sdk';

export interface ProfessorResult {
  feedback: string;
  promptForDebug: string;
}

export async function runProfessorReview(
  firstDraft: string,
  professorCanon: string,
  donorName: string,
  streamCallback?: (text: string) => void
): Promise<ProfessorResult> {
  const client = new Anthropic();

  const systemPrompt = `You are a senior analytical reviewer for donor persuasion profiles. You have deep expertise in the methodology defined in the canon documents below. Your job is to critique the ANALYTICAL QUALITY of a first draft against this methodology.

You are NOT reviewing voice, prose style, or editorial craft. A separate editorial pass handles that. You are reviewing whether the analysis is correct, complete, and grounded in the methodology.

${professorCanon}`;

  const userMessage = `Review this first draft of a persuasion profile for ${donorName} against the canon methodology you have in your instructions.

For each problem you find, state:
1. The exact text that fails
2. Which canon principle it violates (cite the specific memo, manual section, or field guide rule)
3. What the fix looks like — not the rewritten text, but what the corrected version should DO differently

Focus on these analytical failure modes in this priority order:

A. SUBSTRATE RECONSTRUCTION — Has the profile reconstructed the donor's operating system from formation evidence, or does it just describe current behavior? Does Section 1 explain WHY they operate the way they do, grounded in specific biographical forces? (Memo 1)

B. CONTRADICTION QUALITY — Is there a single load-bearing contradiction that creates persuasion leverage? Or are there multiple surface-level contradictions that describe the demographic cohort? Does the contradiction change what the fundraiser does in the room? (Memo 2)

C. DANGEROUS TRUTH — Does the profile surface something the donor believes is breaking in the world that connects to the work? Or does it just describe their values? (Memo 3)

D. INTERIORITY — Are psychological claims structural and predictive, or just descriptive? Does the interiority change what the asker should do, or does it just sound deep? (Memo 4)

E. PRESENCE AND RETREAT — Are shutdown triggers ordered by severity with specific recovery paths? Do recovery paths connect to the psychology that explains the trigger? Or are they generic advice? (Memo 5-6)

F. COMMITMENT PATHWAY — Does S6 show the specific test transaction pattern this donor uses? Is trust built through demonstration, not description? Does it model how they've committed before with enough specificity that the fundraiser can replicate the pattern? (Cognition Manual)

G. EVIDENCE DEPLOYMENT — Are claims grounded in specific evidence, or do they float as psychological assertions? Are quotes deployed as proof for the analysis that follows, or as decoration? (Field Guide)

H. FABRICATED SPECIFICITY — List every specific number in the profile. For each, assess whether the profile states it with more precision than the evidence supports. Flag any number that appears to be invented or rounded in a misleading direction.

I. REPEATED DEPLOYMENT — List every factual claim, quote, or analytical insight that appears more than once. For each, state where it first appears and every subsequent appearance.

J. CROSS-SECTION INTEGRATION — Do later sections (4-7) use the operating system, contradiction, and values hierarchy from sections 1-3 to make their guidance specific? Or could sections 4-7 be detached without losing anything?

Do not rewrite the profile. Do not produce a revised version. Do not comment on prose style or voice. Produce an analytical critique document only.

---

FIRST DRAFT:

${firstDraft}`;

  const response = await client.messages.create({
    model: 'claude-opus-4-20250514',
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  // Build debug-friendly prompt — truncate canon for display only (full canon was sent to API above)
  const promptForDebug = `=== PROFESSOR SYSTEM PROMPT ===
[Canon: ${professorCanon.length} chars — 4 methodology files]

${systemPrompt.slice(0, 500)}...

[TRUNCATED FOR DEBUG — full ${professorCanon.length} chars sent to API]

=== PROFESSOR USER MESSAGE ===

${userMessage}`;

  return { feedback: text, promptForDebug };
}
