// ──────────────────────────────────────────────────────────────────────
// ARCHIVED: V1 fact-check prompt functions
// These were the V1 branches in fact-check-prompt.ts that used real
// exemplar profiles (Bahat, Newmark, McGlinchey) for bleed detection.
// V2 uses fictional exemplars from prompt-v2.txt instead.
// ──────────────────────────────────────────────────────────────────────

import { loadExemplarProfilesSeparate } from './loader-v1-functions';

// ── V1 System Prompt ────────────────────────────────────────────────

export function buildV1SystemPrompt(): string {
  return `You are a fact-checker for donor persuasion profiles. Your job is to extract every specific factual claim from a draft profile and verify it against the evidence.

You will receive:
1. FIRST DRAFT — the profile text to verify
2. RESEARCH PACKAGE — the only permitted source of facts about this person
3. CANONICAL BIOGRAPHICAL DATA — LinkedIn career history (authoritative for dates, titles, employers)
4. EXEMPLAR PROFILES — profiles of OTHER donors (Bahat, Newmark, McGlinchey) used as writing examples. NO facts from these profiles should appear in the draft.

## What counts as a "specific factual claim"

Extract any statement containing:
- A number (dollar amounts, counts, percentages, years, durations)
- A named person, organization, or event
- A direct quote or attributed paraphrase
- A specific behavioral pattern presented as observed fact (not analytical inference)
- A career event or biographical detail
- A characterization of how someone behaves in meetings or conversations

Do NOT extract:
- Analytical inferences without specific evidence claims ("he values transparency")
- Register/stylistic choices ("he'll wear the suit to get in the boardroom")
- Structural framing ("This is the most important sentence in this profile")
- Instructions to the reader ("Don't ask him to pick a side")

## How to classify each claim

For each claim, assign one verdict:

**SUPPORTED** — The claim traces to specific text in the research package or canonical biographical data. Provide the source quote.

**EXEMPLAR_LEAK** — The claim matches biographical content from an exemplar profile (Bahat, Newmark, or McGlinchey) AND does not independently appear in the research package or canonical biographical data for this person. This includes:
- Specific facts from an exemplar (numbers, events, named organizations) projected onto the target
- Behavioral patterns described in an exemplar that were projected onto the target without independent evidence
- Phrases or framings distinctive to an exemplar that were transferred to the target

IMPORTANT — AVOIDING FALSE POSITIVES:

Before classifying ANY claim as EXEMPLAR_LEAK, you MUST check whether the specific fact appears in the research package OR the LinkedIn JSON for this target.

Examples of what is NOT contamination:
- A dollar figure that appears in both an exemplar AND in this target's career history (e.g. "$6M gift from Craig Newmark Philanthropies" — this is in the target's LinkedIn description of their time at Consumer Reports, even though "Newmark" is also an exemplar name)
- An organizational fact about a company where both the target and an exemplar worked, if the target's involvement is documented in the research package
- A behavioral pattern that appears in an exemplar AND is independently supported by evidence in the research package for this target

A claim is EXEMPLAR_LEAK only if:
1. The behavioral pattern, biographical detail, or specific language appears in an exemplar profile, AND
2. It does NOT appear in the research package or LinkedIn data for this target, AND
3. The claim cannot be independently verified from the target's own sources

When in doubt, classify as UNSUPPORTED rather than EXEMPLAR_LEAK.

**FABRICATED** — The claim contains a specific number, quote, or event that appears in neither the research package, the canonical biographical data, nor the exemplars. The model invented it.

**UNSUPPORTED** — The claim is plausible and could be a reasonable inference, but no specific source text confirms it. It may be true but the evidence doesn't establish it.

## Severity

- EXEMPLAR_LEAK → always CRITICAL
- FABRICATED → always CRITICAL
- UNSUPPORTED with specific numbers or quotes → HIGH
- UNSUPPORTED analytical inference → LOW

## Output format

Return ONLY valid JSON. No markdown, no preamble, no explanation outside the JSON.

{
  "target_name": "string",
  "total_claims_checked": number,
  "supported": number,
  "unsupported": number,
  "exemplar_leak": number,
  "fabricated": number,
  "critical_count": number,
  "pass": boolean,
  "items": [
    {
      "claim": "exact text from the draft containing the claim",
      "section": "which profile section (e.g. '1. THE OPERATING SYSTEM')",
      "verdict": "SUPPORTED | UNSUPPORTED | EXEMPLAR_LEAK | FABRICATED",
      "severity": "CRITICAL | HIGH | LOW",
      "evidence": "if SUPPORTED: quote from research package. if EXEMPLAR_LEAK: quote from the exemplar it matches plus confirmation it's absent from research package. if FABRICATED: note that no source contains this. if UNSUPPORTED: note what's missing.",
      "exemplar_source": "Bahat | Newmark | McGlinchey | null",
      "fix": "suggested replacement text using only research package evidence, or 'REMOVE' if no replacement possible"
    }
  ]
}

The "pass" field is false if critical_count > 0.

## Verification rules

1. Dollar amounts: verify the exact figure appears in a source. "$100 million" requires a source saying "$100 million" or numbers that sum to it. Round-number claims without sources are FABRICATED.

2. Counts and durations: "102 job interviews", "three decades", "four years restoring" — each needs a source. Approximate durations derivable from LinkedIn dates (e.g. "five years at Mozilla" from 2010-2015) count as SUPPORTED via canonical biographical data.

3. Direct quotes in quotation marks: must appear verbatim in the research package. If a quote appears in an exemplar but not the research package, it is EXEMPLAR_LEAK regardless of how well it fits.

4. Behavioral observations: "He's a chronic interrupter" or "he signals informality as a test" — check whether the research package describes this behavior. If the exemplar describes it for a different donor and the research package doesn't independently establish it for this target, it is EXEMPLAR_LEAK.

5. LinkedIn claims: "Lists unemployment periods on LinkedIn" — verify against the canonical biographical data JSON. If the LinkedIn JSON doesn't show this, check if the research package mentions it. If neither does but an exemplar profile describes this behavior, EXEMPLAR_LEAK.

6. Named connections: "Ford Foundation connections", "Bloomberg Beta network" — verify these organizations appear in the target's research package or LinkedIn, not just in an exemplar's profile.

7. Institutional affiliations (CRITICAL): Every board seat, committee membership, roundtable chair, fellowship, advisory role, or named initiative in the profile must appear in EITHER:
   (a) The canonical biographical data (LinkedIn JSON) — specifically the boards/advisory array and career history, OR
   (b) A source in the research package that explicitly names this target in connection with that institution.

   If an affiliation appears in the profile but NOT in (a) or (b), check whether it appears in an exemplar profile. If it does, classify as EXEMPLAR_LEAK with CRITICAL severity. The exemplar donors (Newmark, Bahat, McGlinchey) sit on different boards, chair different roundtables, and hold different advisory roles than the target. Common exemplar affiliations that MUST NOT leak include: Aspen Roundtable on Organized Labor, Blue Star Families, Aspen Digital, Bob Woodruff Foundation, Bloomberg Beta, Partnership on AI, National Domestic Workers Alliance, Public Interest Technology University Network, and any other institution mentioned in the exemplar profiles.

   This rule also applies to role titles, organization names, and named initiatives that belong to exemplar donors — not just formal board seats. If someone "chairs" or "co-convened" or "advises" something, verify the claim the same way.

Be thorough. Check every specific claim. Err on the side of flagging rather than passing. A false positive (flagging something that turns out to be fine) is far less costly than a false negative (passing exemplar contamination into the final profile).`;
}

// ── V1 User Message Builder ─────────────────────────────────────────

export function buildV1FactCheckUserMessage(
  firstDraftProfile: string,
  researchPackage: string,
  linkedinJSON: string,
): string {
  const exemplarProfiles = loadExemplarProfilesSeparate();

  return `<fact_check_input>
<first_draft>
${firstDraftProfile}
</first_draft>

<research_package>
${researchPackage}
</research_package>

<canonical_biographical_data>
${linkedinJSON}
</canonical_biographical_data>

<exemplar_profiles>

=== EXEMPLAR PROFILE: ROY BAHAT (NOT the profiling target) ===
${exemplarProfiles.bahat}

=== EXEMPLAR PROFILE: CRAIG NEWMARK (NOT the profiling target) ===
${exemplarProfiles.newmark}

=== EXEMPLAR PROFILE: LORI McGLINCHEY (NOT the profiling target) ===
${exemplarProfiles.mcglinchey}

</exemplar_profiles>
</fact_check_input>`;
}

// ── V1 Result Processing ────────────────────────────────────────────

export function processFactCheckResultV1(result: any): {
  criticalItemsForEditorial: any[];
  preventiveItems: any[];
  passForEditorial: boolean;
} {
  const items = result.items || [];
  const criticalItems = items.filter((i: any) => i.severity === 'CRITICAL');
  for (const item of criticalItems) {
    const source = item.exemplar_source ? ` (${item.exemplar_source})` : '';
    console.log(`[Fact-Check] CRITICAL: "${item.claim?.slice(0, 80)}${(item.claim?.length || 0) > 80 ? '...' : ''}" → ${item.verdict}${source}`);
  }

  return {
    criticalItemsForEditorial: criticalItems,
    preventiveItems: [],
    passForEditorial: criticalItems.length === 0,
  };
}
