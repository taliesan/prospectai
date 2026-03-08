// ARCHIVED: Legacy deep-research entry point removed from research/deep-research.ts
// Date: February 2026
// Reason: Standalone backward-compat entry point, not called by active pipeline
// Original location: research/deep-research.ts ~line 493
// Also includes buildLegacyUserPrompt() ~line 144

import type { LinkedInData } from '../prompts/extraction-prompt';

// Types referenced
type ProgressCallback = (message: string, phase?: string, step?: number, totalSteps?: number) => void;
type ActivityCallback = (activity: any) => void;

interface DeepResearchResult {
  dossier: string;
  citations: any[];
  searchCount: number;
  tokenUsage: any;
  durationMs: number;
  researchStrategy: string;
  evidenceDensity: 'HIGH' | 'MEDIUM' | 'LOW';
}

function buildLegacyUserPrompt(
  donorName: string,
  linkedinData: LinkedInData | null,
  seedUrl: string | null,
  seedUrlContent: string | null,
): string {
  let prompt = `# RESEARCH BRIEF\n\n`;
  prompt += `## Donor: ${donorName}\n\n`;

  if (linkedinData) {
    prompt += `## What We Already Know\n`;
    const linkedinJson: Record<string, any> = {};
    if (linkedinData.currentTitle) linkedinJson.currentTitle = linkedinData.currentTitle;
    if (linkedinData.currentEmployer) linkedinJson.currentEmployer = linkedinData.currentEmployer;
    if (linkedinData.linkedinSlug) linkedinJson.linkedinSlug = linkedinData.linkedinSlug;
    if (linkedinData.websites?.length) linkedinJson.websites = linkedinData.websites;
    if (linkedinData.careerHistory?.length) linkedinJson.careerHistory = linkedinData.careerHistory;
    if (linkedinData.education?.length) linkedinJson.education = linkedinData.education;
    if (linkedinData.boards?.length) linkedinJson.boards = linkedinData.boards;
    prompt += JSON.stringify(linkedinJson, null, 2);
    prompt += `\n\n`;
  }

  if (seedUrl || seedUrlContent) {
    prompt += `## Seed Material\n`;
    if (seedUrl) prompt += `Source: ${seedUrl}\n\n`;
    if (seedUrlContent) prompt += seedUrlContent.slice(0, 30000) + `\n\n`;
  }

  prompt += `## Your Assignment\nResearch this person thoroughly. Find everything that helps someone prepare for a high-stakes fundraising meeting with them. Prioritize behavioral evidence — how they think, decide, and operate — over biographical facts.\n`;
  return prompt;
}

export async function runDeepResearchPipeline(
  donorName: string,
  seedUrls: string[],
  linkedinData: LinkedInData | null,
  seedUrlContent: string | null,
  onProgress?: ProgressCallback,
  abortSignal?: AbortSignal,
  onActivity?: ActivityCallback,
): Promise<DeepResearchResult> {
  // This function has been archived. It was a legacy entry point that
  // built a simpler developer message (no pre-fetched sources, no gap analysis)
  // and called executeDeepResearch() directly.
  //
  // The active pipeline now uses runDeepResearchV5() which receives
  // pre-scored sources and a coverage gap report from Stage 5.
  throw new Error('runDeepResearchPipeline has been archived. Use runDeepResearchV5 instead.');
}
