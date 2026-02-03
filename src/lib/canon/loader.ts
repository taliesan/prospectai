// Canon document loader
// In production, these would be loaded from files
// For now, we'll export functions that expect the canon to be passed in

export interface CanonDocuments {
  memos: string;        // The 13 Memos
  fieldGuide: string;   // Field Guide for Profilers
  cognitionManual: string; // Cognition Manual
  exemplarProfiles: string; // A+++ Canonical Profiles
}

// Key excerpts from the canon for different purposes
// These would be the full documents in production

export const CANON_SUMMARY = `
# DTW DONOR PROFILING CANON SUMMARY

## Core Principles (from The 13 Memos)

### Memo 1: Substrate Reconstruction
- Structure is substrate - infer internal architecture from observable patterns
- Career structure reveals risk tolerance, authorship comfort, power orientation
- What they build reveals their theory of power
- Role continuity shows identity backbone

### Memo 2: Contradiction Leverage
- Every donor has a primary contradiction - tension between identity, worldview, and incentives
- The contradiction is load-bearing - it explains behavior across contexts
- Contradictions are persuasion territory - where movement is possible

### Memo 5: Stress & Retreat Diagnostics
- How donors behave under stress is more revealing than comfort-zone behavior
- Retreat signals: procedural language, questions becoming narrower, emotional cooling
- Recovery is possible if you catch retreat early

### Memo 8: Dangerous Truth Extraction
- The civic-scale fear that drives their engagement
- Not personal fear - system-level anxiety about institutional decay
- This explains their long-term orientation and what they fund

### Memo 13: Substrate & Memory
- Substrate = stable internal structure producing repeatable behavior
- Inferred from constraint, not confession
- What they choose under pressure, not what they say when relaxed

## Rendering Rules (from Field Guide)

### The Seven Sections (Fixed Order)
1. Donor Identity & Background
2. Core Motivations, Values & Triggers
3. Ideal Engagement Style
4. Challenges & Risk Factors
5. Strategic Opportunities for Alignment
6. Tactical Approach to the Meeting
7. Dinner Party Test

### Bullet Requirements
- Behavioral, not biographical
- Conditional logic (when X, they do Y)
- Consequence for asker implied
- Specific to this donor (name-swap test)

### Voice
- Intimate without sentimentality
- Observational, not evaluative
- Slightly uncanny (donor would recognize themselves)
- Architectural - pattern-first, system-aware

## Quality Test (from Cognition Manual)

A correct profile:
- Feels like a real person in a real room
- Is donor-specific - obviously wrong for anyone else
- Is operational - every section changes asker behavior
- Has gravity - interiority is structural, not emotive
- Would survive the name-swap test
- Contains substantive contradiction
- Makes retreat patterns explicit
`;

export const PROFILE_QUALITY_CHECKLIST = `
## A+++ Profile Quality Checklist

Before finalizing, verify:

□ Every bullet describes BEHAVIOR, not traits
□ Every bullet has conditional logic (when/if/under pressure)
□ Every bullet implies consequence for asker
□ No bullet could apply to a different donor (name-swap test)
□ Core contradiction is surfaced and specific
□ Retreat patterns are explicit - I know how they disengage
□ Section 6 (Tactical) could run the entire meeting alone
□ Section 7 (Dinner) captures informal presence
□ All claims trace to dossier evidence
□ Quality matches exemplars (Roy Bahat standard)

If ANY checkbox fails, the profile is not ready.
`;

export function selectExemplars(dossier: string, allExemplars: string): string {
  // In a full implementation, this would:
  // 1. Analyze the dossier to determine donor type
  // 2. Select 3-5 most relevant exemplars
  // For now, return a subset of exemplars
  
  // Extract Roy Bahat and 2 others as default exemplars
  // The full implementation would be smarter about matching
  
  const exemplarSections = allExemplars.split(/(?=## ⭐|## DONOR PERSUASION PROFILE|## STEP-3)/);
  
  // Get first 3 complete profiles
  const selected = exemplarSections
    .filter(s => s.trim().length > 500)
    .slice(0, 3)
    .join('\n\n---\n\n');
  
  return selected || allExemplars.slice(0, 30000);
}
