// Canon document loader
import * as fs from 'fs';
import * as path from 'path';

// Cache for exemplars (loaded once at runtime)
let exemplarsCache: string | null = null;

/**
 * Load exemplar profiles from the exemplars.md file.
 * Caches the result after first load.
 */
export function loadExemplars(): string {
  if (exemplarsCache !== null) {
    return exemplarsCache;
  }

  try {
    const exemplarsPath = path.join(process.cwd(), 'src/lib/canon/exemplars.md');
    exemplarsCache = fs.readFileSync(exemplarsPath, 'utf-8');
    console.log(`[Canon] Loaded exemplars: ${exemplarsCache.length} characters`);
    return exemplarsCache;
  } catch (error) {
    console.error('[Canon] Failed to load exemplars.md:', error);
    // Return empty string if file not found - validators will catch missing exemplars
    return '';
  }
}

/**
 * Returns all exemplars. No selection logic - the model needs to see the full range.
 */
export function selectExemplars(_dossier: string, allExemplars: string): string {
  // Return all exemplars - the model needs to see the full range of what A+++ looks like
  return allExemplars;
}

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
□ Quality matches exemplars

If ANY checkbox fails, the profile is not ready.
`;
