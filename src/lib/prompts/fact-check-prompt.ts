// STAGE 3a: Fact-Check Prompt Builder
// Uses fictional exemplars (pirate, octopus, mycelium) for bleed detection
// + supplementary old real-exemplar word list as regression safety net

import type { LinkedInData } from './extraction-prompt';
import { loadPromptV2 } from '../canon/loader';

// ── Bleed-check word lists ──────────────────────────────────────────

const OLD_EXEMPLAR_TERMS = [
  'Newmark', 'Bahat', 'McGlinchey',
  'craigslist', 'Bloomberg', 'OUYA', 'Ghostface Killah', 'Heschel',
  'work is broken in America',
  'everyone wants you to be blunt and transparent',
  'the nerd thing is real',
  'Partnership on AI', 'PIT University Network',
  'Aspen Digital', 'Aspen Roundtable',
  'Blue Star Families', 'Bob Woodruff Foundation',
  'CUNY',
  'chronic interrupter',
  'lists unemployment periods on LinkedIn',
];

const FICTIONAL_EXEMPLAR_TERMS = [
  'Inés de la Cerda', 'Aguila Negra', 'Tortuga', 'articles of conduct', 'prize court',
  'Luma Orekh', 'Abyssal Archive', 'dead maps', 'Pelagic Cartographers', 'chromatic pulse',
  'Ymmra', 'Grotto Surath', 'Threshold Lattice', 'deep-source veins', 'tidal cycle',
  'mycorrhizal', 'hyphae', 'substrate', 'gallery', 'scout mycelium',
];

// ── Exemplar zone extractor ─────────────────────────────────────────

function extractExemplarZone(): string {
  const promptV2 = loadPromptV2();
  const marker = '═══════════════════════════════════════════════════════════════════════';
  const firstIdx = promptV2.indexOf(marker);
  const secondIdx = promptV2.indexOf(marker, firstIdx + marker.length);
  if (firstIdx === -1 || secondIdx === -1) {
    console.warn('[Fact-Check] Could not extract exemplar zone from prompt-v2.txt');
    return '';
  }
  return promptV2.substring(firstIdx, secondIdx + marker.length).trim();
}

// ── System Prompt ───────────────────────────────────────────────────

export function buildFactCheckSystemPrompt(): string {
  return `You are a fact-checker for donor persuasion profiles. Your job is to extract every specific factual claim from a draft profile and verify it against the evidence.

You will receive:
1. FIRST DRAFT — the profile text to verify
2. RESEARCH PACKAGE — the only permitted source of facts about this person
3. CANONICAL BIOGRAPHICAL DATA — LinkedIn career history (authoritative for dates, titles, employers)
4. FICTIONAL EXEMPLAR PROFILES — profiles of FICTIONAL CHARACTERS (a pirate captain, an octopus cartographer, and a mycorrhizal network) used as writing examples during profile generation. NO content from these exemplars should appear in the draft.
5. BLEED-CHECK WORD LISTS — terms from both fictional and old real-person exemplars that should not appear in the draft

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

**EXEMPLAR_LEAK** — The claim matches content from an exemplar profile AND does not independently appear in the research package or canonical biographical data for this person. This includes:
- Specific facts, names, places, or events from a fictional exemplar (pirate captain, octopus, mycelium) projected onto the target
- Specific facts from old real-person exemplars (Bahat, Newmark, McGlinchey) projected onto the target
- Behavioral patterns or distinctive phrases from any exemplar transferred without independent evidence
- Any term from the FICTIONAL EXEMPLAR TERMS list found in the draft — this is an AUTOMATIC FAILURE (fictional content has zero chance of being independently true)

IMPORTANT — AVOIDING FALSE POSITIVES:

Before classifying ANY claim as EXEMPLAR_LEAK from the OLD EXEMPLAR TERMS list, you MUST check whether the specific fact appears in the research package OR the LinkedIn JSON for this target.

Examples of what is NOT contamination:
- A dollar figure that appears in both an old exemplar AND in this target's career history
- An organizational fact about a company where both the target and an old exemplar worked, if the target's involvement is documented in the research package
- A behavioral pattern that appears in an old exemplar AND is independently supported by evidence in the research package for this target

A claim is EXEMPLAR_LEAK from old exemplar terms only if:
1. The term or pattern appears in an old exemplar profile, AND
2. It does NOT appear in the research package or LinkedIn data for this target, AND
3. The claim cannot be independently verified from the target's own sources

When in doubt about old exemplar terms, classify as UNSUPPORTED rather than EXEMPLAR_LEAK.

For FICTIONAL EXEMPLAR TERMS: any match is automatic EXEMPLAR_LEAK — fictional characters cannot appear in real donor profiles.

**FABRICATED** — The claim contains a specific number, quote, or event that appears in neither the research package, the canonical biographical data, nor any exemplar. The model invented it.

**UNSUPPORTED** — The claim is plausible and could be a reasonable inference, but no specific source text confirms it. It may be true but the evidence doesn't establish it.

**USER_PROVIDED** — The claim traces to user-supplied context (prior meetings, direct knowledge from the fundraiser) but not to web research. These claims are acceptable in the profile — they don't need web corroboration. Only flag as UNSUPPORTED if user-supplied context CONTRADICTS web evidence.

## Severity

- EXEMPLAR_LEAK → always CRITICAL
- FABRICATED → always CRITICAL
- UNSUPPORTED with specific numbers or quotes → HIGH
- UNSUPPORTED analytical inference → LOW
- USER_PROVIDED → LOW (informational, not a failure)

## CRITICAL: Distinguish FOUND vs PREVENTIVE

For each item, you MUST set the "found_in_draft" field:
- **true** if the claim/term was actually found in the first draft text
- **false** if you are checking preventively (confirming absence)

Only items where found_in_draft is true represent actual contamination that needs fixing.
Items where found_in_draft is false are preventive confirmations — log them but they are not failures.

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
  "critical_found_in_draft": number,
  "pass": boolean,
  "items": [
    {
      "claim": "exact text from the draft containing the claim",
      "section": "which profile section (e.g. '1. THE OPERATING SYSTEM')",
      "verdict": "SUPPORTED | UNSUPPORTED | EXEMPLAR_LEAK | FABRICATED",
      "severity": "CRITICAL | HIGH | LOW",
      "found_in_draft": true,
      "evidence": "if SUPPORTED: quote from research package. if EXEMPLAR_LEAK: which exemplar it matches plus confirmation it's absent from research package. if FABRICATED: note that no source contains this. if UNSUPPORTED: note what's missing.",
      "exemplar_source": "fictional_pirate | fictional_octopus | fictional_mycelium | old_Bahat | old_Newmark | old_McGlinchey | null",
      "fix": "suggested replacement text using only research package evidence, or 'REMOVE' if no replacement possible"
    }
  ]
}

The "pass" field is false if critical_found_in_draft > 0.
The "critical_count" field counts ALL critical items (both found and preventive).
The "critical_found_in_draft" field counts only items actually found in the draft.

## Verification rules

1. Dollar amounts: verify the exact figure appears in a source. "$100 million" requires a source saying "$100 million" or numbers that sum to it. Round-number claims without sources are FABRICATED.

2. Counts and durations: "102 job interviews", "three decades", "four years restoring" — each needs a source. Approximate durations derivable from LinkedIn dates (e.g. "five years at Mozilla" from 2010-2015) count as SUPPORTED via canonical biographical data.

3. Direct quotes in quotation marks: must appear verbatim in the research package. If a quote appears in an exemplar but not the research package, it is EXEMPLAR_LEAK regardless of how well it fits.

4. Behavioral observations: "He's a chronic interrupter" or "he signals informality as a test" — check whether the research package describes this behavior. If an exemplar describes it for a different donor/character and the research package doesn't independently establish it for this target, it is EXEMPLAR_LEAK.

5. LinkedIn claims: verify against the canonical biographical data JSON. If the LinkedIn JSON doesn't show this, check if the research package mentions it.

6. Named connections: verify organizations appear in the target's research package or LinkedIn, not just in an exemplar's profile.

7. Institutional affiliations (CRITICAL): Every board seat, committee membership, roundtable chair, fellowship, advisory role, or named initiative in the profile must appear in EITHER:
   (a) The canonical biographical data (LinkedIn JSON), OR
   (b) A source in the research package that explicitly names this target in connection with that institution.

Be thorough. Check every specific claim. Err on the side of flagging rather than passing.`;
}

// ── User Message Builder ────────────────────────────────────────────

export function buildFactCheckUserMessage(
  firstDraftProfile: string,
  researchPackage: string,
  linkedinData: LinkedInData | null | undefined,
): string {
  const linkedinJSON = linkedinData ? JSON.stringify(linkedinData, null, 2) : 'No LinkedIn data available.';
  const exemplarZone = extractExemplarZone();

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

<fictional_exemplar_profiles>
The following fictional exemplar profiles were used as writing examples during profile generation.
ANY content from these exemplars found in the draft is AUTOMATIC FAILURE — fictional characters cannot appear in real donor profiles.

${exemplarZone}
</fictional_exemplar_profiles>

<bleed_check_word_lists>

FICTIONAL EXEMPLAR TERMS (flag if found in draft — automatic failure):
${FICTIONAL_EXEMPLAR_TERMS.join(', ')}

OLD EXEMPLAR TERMS (flag if found in draft without independent source verification):
${OLD_EXEMPLAR_TERMS.join(', ')}

</bleed_check_word_lists>
</fact_check_input>`;
}

/**
 * Process fact-check results: distinguish found-in-draft from preventive checks.
 * Returns only items actually found in the draft as critical items for the editorial pass.
 */
export function processFactCheckResult(result: any): {
  criticalItemsForEditorial: any[];
  preventiveItems: any[];
  passForEditorial: boolean;
} {
  const items = result.items || [];

  const criticalItemsForEditorial = items.filter(
    (i: any) => i.severity === 'CRITICAL' && i.found_in_draft !== false
  );
  const preventiveItems = items.filter(
    (i: any) => i.severity === 'CRITICAL' && i.found_in_draft === false
  );

  // Log preventive items at info level
  for (const item of preventiveItems) {
    const source = item.exemplar_source ? ` (${item.exemplar_source})` : '';
    console.log(`[Fact-Check] PREVENTIVE CHECK (not in draft): "${item.claim?.slice(0, 60) || 'N/A'}..." → ${item.verdict}${source}`);
  }

  // Log actual findings
  for (const item of criticalItemsForEditorial) {
    const source = item.exemplar_source ? ` (${item.exemplar_source})` : '';
    console.log(`[Fact-Check] FOUND IN DRAFT: "${item.claim?.slice(0, 80)}${(item.claim?.length || 0) > 80 ? '...' : ''}" → ${item.verdict}${source}`);
  }

  return {
    criticalItemsForEditorial,
    preventiveItems,
    passForEditorial: criticalItemsForEditorial.length === 0,
  };
}
