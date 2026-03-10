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
const geoffreyBlockCache = loadCanonFile('geoffrey-block.md');
const meetingGuideBlockV3Cache = loadCanonFile('meeting-guide-block-v3.md');
const meetingGuideOutputTemplateCache = loadCanonFile('meeting-guide-output-template.md');
const meetingGuideInesCache = loadCanonFile('meeting-guide-ines-de-la-cerda.md');
const meetingGuideLumaCache = loadCanonFile('meeting-guide-luma-orekh.md');
const meetingGuideYmmraCache = loadCanonFile('meeting-guide-ymmra.md');
const promptV2Cache = loadCanonFile('prompt-v2.txt');
const critiqueEditorialV2Cache = loadCanonFile('critique-editorial-v2.txt');
const stage0OrgIntakeCache = loadCanonFile('stage-0-org-intake-prompt.md');
const tidebreakStrategicFrameCache = loadCanonFile('org-strategic-frame-tidebreak.md');

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
 * Returns the Tidebreak org frame + all fictional meeting guide exemplars for the prompt.
 */
export function loadMeetingGuideExemplars(): string {
  return `## EXEMPLAR ORG FRAME

${tidebreakStrategicFrameCache}

---

## EXEMPLAR GUIDE 1

${meetingGuideInesCache}

---

## EXEMPLAR GUIDE 2

${meetingGuideLumaCache}

---

## EXEMPLAR GUIDE 3

${meetingGuideYmmraCache}`;
}

export interface ProjectLayerInput {
  name: string;
  processedBrief: string;
  issueAreas?: string;
  defaultAsk?: string;
  specificAsk?: string;
  fundraiserName?: string;
  strategicFrame?: string;
}

export function buildProjectLayer(projectContext: ProjectLayerInput): string {
  return `# ORGANIZATION / PROJECT CONTEXT

## ${projectContext.name}

### Mission, Theory of Change, or Project Scope
${projectContext.processedBrief}

### Issue Areas
${projectContext.issueAreas || 'Not specified'}

### Default Ask
${projectContext.defaultAsk || 'Not specified'}

### This Meeting's Specific Ask
${projectContext.specificAsk || 'Not specified'}

### Fundraiser
${projectContext.fundraiserName || 'Not specified'}`.trim();
}

/** Individual meeting guide exemplars for conversation mode */
export function loadMeetingGuideInes(): string {
  return meetingGuideInesCache;
}
export function loadMeetingGuideLuma(): string {
  return meetingGuideLumaCache;
}
export function loadMeetingGuideYmmra(): string {
  return meetingGuideYmmraCache;
}

export function loadPromptV2(): string {
  return promptV2Cache;
}

export function loadCritiqueEditorialV2(): string {
  return critiqueEditorialV2Cache;
}

export function loadStage0OrgIntakePrompt(): string {
  return stage0OrgIntakeCache;
}

export function loadTidebreakStrategicFrame(): string {
  return tidebreakStrategicFrameCache;
}

// Professor canon files — loaded lazily and cached (large files, only used by professor call)
let professorCanonCache: string | null = null;

export function loadProfessorCanon(): string {
  if (professorCanonCache) return professorCanonCache;

  const professorFiles = [
    'professor/Donor_Profiles_3_0_-_The_13_Memos.md',
    'professor/Donor_Profiles_3_0_-_Cognition_Manual.md',
    'professor/Donor_Profiles_3_0_-_Field_Guide_for_Profilers.md',
    'professor/Final_Donor_Profile_-_Fundraising_Canon.md',
  ];

  const sections: string[] = [];
  for (const file of professorFiles) {
    try {
      const filePath = path.join(process.cwd(), 'src/lib/canon', file);
      const content = fs.readFileSync(filePath, 'utf-8');
      console.log(`[Canon] Loaded professor/${file}: ${content.length} characters`);
      sections.push(content);
    } catch (error) {
      console.error(`[Canon] Failed to load professor file ${file}:`, error);
      throw new Error(`Professor canon file missing: ${file}. These files must be provided manually — do not generate them.`);
    }
  }

  professorCanonCache = sections.join('\n\n---\n\n');
  console.log(`[Canon] Professor canon loaded: ${professorCanonCache.length} total characters`);
  return professorCanonCache;
}
