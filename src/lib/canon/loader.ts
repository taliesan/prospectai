// Canon document loader
// All canon documents are loaded eagerly at module init (read-only, no race conditions)
import * as fs from 'fs';
import * as path from 'path';

function loadCanonFile(filename: string): string {
  try {
    const filePath = path.join(process.cwd(), 'src/lib/canon', filename);
    const content = fs.readFileSync(filePath, 'utf-8');
    console.log(`[Canon] Loaded ${filename}: ${content.length} characters`);
    return content;
  } catch (error) {
    console.error(`[Canon] Failed to load ${filename}:`, error);
    return '';
  }
}

// Eagerly load all canon documents at module initialization
const exemplarsCache = loadCanonFile('exemplars.md');
const geoffreyBlockCache = loadCanonFile('geoffrey-block.md');
const meetingGuideBlockCache = loadCanonFile('meeting-guide-block.md');
const meetingGuideExemplarsCache = loadCanonFile('meeting-guide-exemplars.md');
const dtwOrgLayerCache = loadCanonFile('dtw-org-layer.md');

export function loadExemplars(): string {
  return exemplarsCache;
}

/**
 * Returns all exemplars. No selection logic - the model needs to see the full range.
 */
export function selectExemplars(_researchPackage: string, allExemplars: string): string {
  return allExemplars;
}

export function loadGeoffreyBlock(): string {
  return geoffreyBlockCache;
}

export function loadMeetingGuideBlock(): string {
  return meetingGuideBlockCache;
}

export function loadMeetingGuideExemplars(): string {
  return meetingGuideExemplarsCache;
}

export function loadDTWOrgLayer(): string {
  return dtwOrgLayerCache;
}
