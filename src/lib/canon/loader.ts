// Canon document loader
import * as fs from 'fs';
import * as path from 'path';

// Cache for exemplars (loaded once at runtime)
let exemplarsCache: string | null = null;
let geoffreyBlockCache: string | null = null;
let meetingGuideBlockCache: string | null = null;
let meetingGuideExemplarsCache: string | null = null;
let dtwOrgLayerCache: string | null = null;

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

/**
 * Load the Meeting Guide Block from meeting-guide-block.md.
 * Voice, register, and standards for Meeting Guide generation.
 */
export function loadMeetingGuideBlock(): string {
  if (meetingGuideBlockCache !== null) {
    return meetingGuideBlockCache;
  }

  try {
    const blockPath = path.join(process.cwd(), 'src/lib/canon/meeting-guide-block.md');
    meetingGuideBlockCache = fs.readFileSync(blockPath, 'utf-8');
    console.log(`[Canon] Loaded Meeting Guide Block: ${meetingGuideBlockCache.length} characters`);
    return meetingGuideBlockCache;
  } catch (error) {
    console.error('[Canon] Failed to load meeting-guide-block.md:', error);
    return '';
  }
}

/**
 * Load Meeting Guide exemplars from meeting-guide-exemplars.md.
 * Three concatenated A+++ Meeting Guides that teach the model quality standard.
 */
export function loadMeetingGuideExemplars(): string {
  if (meetingGuideExemplarsCache !== null) {
    return meetingGuideExemplarsCache;
  }

  try {
    const exemplarsPath = path.join(process.cwd(), 'src/lib/canon/meeting-guide-exemplars.md');
    meetingGuideExemplarsCache = fs.readFileSync(exemplarsPath, 'utf-8');
    console.log(`[Canon] Loaded Meeting Guide Exemplars: ${meetingGuideExemplarsCache.length} characters`);
    return meetingGuideExemplarsCache;
  } catch (error) {
    console.error('[Canon] Failed to load meeting-guide-exemplars.md:', error);
    return '';
  }
}

/**
 * Load the DTW Organization Layer from dtw-org-layer.md.
 * Mission, theory of change, portfolio, values, and language conventions.
 */
export function loadDTWOrgLayer(): string {
  if (dtwOrgLayerCache !== null) {
    return dtwOrgLayerCache;
  }

  try {
    const orgLayerPath = path.join(process.cwd(), 'src/lib/canon/dtw-org-layer.md');
    dtwOrgLayerCache = fs.readFileSync(orgLayerPath, 'utf-8');
    console.log(`[Canon] Loaded DTW Org Layer: ${dtwOrgLayerCache.length} characters`);
    return dtwOrgLayerCache;
  } catch (error) {
    console.error('[Canon] Failed to load dtw-org-layer.md:', error);
    return '';
  }
}
