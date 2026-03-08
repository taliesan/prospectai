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
 * Returns all fictional meeting guide exemplars for the prompt.
 */
export function loadMeetingGuideExemplars(): string {
  return [
    meetingGuideInesCache,
    meetingGuideLumaCache,
    meetingGuideYmmraCache,
  ].join('\n\n---\n\n');
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

export function loadPromptV2(): string {
  return promptV2Cache;
}

export function loadCritiqueEditorialV2(): string {
  return critiqueEditorialV2Cache;
}

export function loadStage0OrgIntakePrompt(): string {
  return stage0OrgIntakeCache;
}
