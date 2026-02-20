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
const promptV2Cache = loadCanonFile('prompt-v2.txt');

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

export function loadPromptV2(): string {
  return promptV2Cache;
}

/**
 * Returns the three exemplar profiles as separate strings for fact-checking.
 * Each profile is extracted by splitting on the "# PERSUASION PROFILE —" heading.
 */
export function loadExemplarProfilesSeparate(): {
  bahat: string;
  newmark: string;
  mcglinchey: string;
} {
  const full = exemplarsCache;
  // Split on the profile headings, keeping the heading with its content
  const profileStarts = [
    { name: 'newmark' as const, marker: '# PERSUASION PROFILE — CRAIG NEWMARK' },
    { name: 'bahat' as const, marker: '# PERSUASION PROFILE — ROY BAHAT' },
    { name: 'mcglinchey' as const, marker: '# PERSUASION PROFILE — LORI McGLINCHEY' },
  ];

  const result: Record<string, string> = { bahat: '', newmark: '', mcglinchey: '' };

  for (let i = 0; i < profileStarts.length; i++) {
    const startIdx = full.indexOf(profileStarts[i].marker);
    if (startIdx === -1) continue;
    const nextStart = i + 1 < profileStarts.length
      ? full.indexOf(profileStarts[i + 1].marker)
      : full.length;
    result[profileStarts[i].name] = full.slice(startIdx, nextStart !== -1 ? nextStart : full.length).trim();
  }

  return result as { bahat: string; newmark: string; mcglinchey: string };
}
