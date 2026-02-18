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
const meetingGuideBlockV3Cache = loadCanonFile('meeting-guide-block-v3.md');
const meetingGuideOutputTemplateCache = loadCanonFile('meeting-guide-output-template.md');
const meetingGuideNewmarkCache = loadCanonFile('meeting-guide-craig-newmark.md');
const meetingGuideBahatCache = loadCanonFile('meeting-guide-roy-bahat.md');
const meetingGuideMcGlincheyCache = loadCanonFile('meeting-guide-lori-mcglinchey.md');
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

export function loadMeetingGuideBlockV3(): string {
  return meetingGuideBlockV3Cache;
}

export function loadMeetingGuideOutputTemplate(): string {
  return meetingGuideOutputTemplateCache;
}

/**
 * Returns meeting guide exemplars for the prompt, excluding the exemplar
 * that matches the current donor (by lowercase last-name match in filename).
 */
export function loadMeetingGuideExemplars(donorName: string): string {
  const allExemplars = [
    { name: 'newmark', content: meetingGuideNewmarkCache },
    { name: 'bahat', content: meetingGuideBahatCache },
    { name: 'mcglinchey', content: meetingGuideMcGlincheyCache },
  ];

  const donorLower = donorName.toLowerCase();
  const selected = allExemplars.filter(e => !donorLower.includes(e.name));

  if (selected.length === allExemplars.length) {
    // No match found — return all 3
    return selected.map(e => e.content).join('\n\n---\n\n');
  }

  // Excluded one — return the remaining 2
  return selected.map(e => e.content).join('\n\n---\n\n');
}

export function loadDTWOrgLayer(): string {
  return dtwOrgLayerCache;
}
