// Archive: v1 fact-check logic — inline in pipeline.ts (lines 1543–1760)
// Archived: 2026-02-20
// Reason: v2 replaces real-person exemplars with fictional exemplars for bleed detection
// Revert: set PROMPT_VERSION=v1 in environment
//
// In v1, the fact-checker:
// - Loaded real exemplar profiles (Bahat, Newmark, McGlinchey) via loadExemplarProfilesSeparate()
// - Used those as reference text to detect bleed from real-person exemplars
// - Did not distinguish between "found in draft" and "preventive check" — all items
//   flagged as CRITICAL were passed to the editorial pass regardless
//
// The v1 system prompt and user message are preserved below as reference.

export const V1_FACT_CHECK_SYSTEM_PROMPT = `You are a fact-checker for donor persuasion profiles. Your job is to extract every specific factual claim from a draft profile and verify it against the evidence.

You will receive:
1. FIRST DRAFT — the profile text to verify
2. RESEARCH PACKAGE — the only permitted source of facts about this person
3. CANONICAL BIOGRAPHICAL DATA — LinkedIn career history (authoritative for dates, titles, employers)
4. EXEMPLAR PROFILES — profiles of OTHER donors (Bahat, Newmark, McGlinchey) used as writing examples. NO facts from these profiles should appear in the draft.

[... full v1 system prompt was inline in pipeline.ts ...]`;

// The v1 user message assembled exemplar profiles like:
// === EXEMPLAR PROFILE: ROY BAHAT (NOT the profiling target) ===
// ${exemplarProfiles.bahat}
// === EXEMPLAR PROFILE: CRAIG NEWMARK (NOT the profiling target) ===
// ${exemplarProfiles.newmark}
// === EXEMPLAR PROFILE: LORI McGLINCHEY (NOT the profiling target) ===
// ${exemplarProfiles.mcglinchey}
