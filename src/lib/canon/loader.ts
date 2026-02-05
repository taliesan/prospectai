// Canon document loader
import * as fs from 'fs';
import * as path from 'path';

// Cache for exemplars (loaded once at runtime)
let exemplarsCache: string | null = null;
let geoffreyBlockCache: string | null = null;

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

/**
 * Load the Geoffrey Block from geoffrey-block.md.
 * System-level context for voice, standards, and decision-making.
 * Placed at the top of the context window, before exemplars and sources.
 */
export function loadGeoffreyBlock(): string {
  if (geoffreyBlockCache !== null) {
    return geoffreyBlockCache;
  }

  try {
    const blockPath = path.join(process.cwd(), 'src/lib/canon/geoffrey-block.md');
    geoffreyBlockCache = fs.readFileSync(blockPath, 'utf-8');
    console.log(`[Canon] Loaded Geoffrey Block: ${geoffreyBlockCache.length} characters`);
    return geoffreyBlockCache;
  } catch (error) {
    console.error('[Canon] Failed to load geoffrey-block.md:', error);
    return '';
  }
}
