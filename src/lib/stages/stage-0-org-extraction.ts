// Stage 0 — Org Strategic Extraction
//
// Runs once per ProjectContext (on create/update, not per pipeline run).
// Converts raw org materials into a structured strategic frame
// that replaces raw org text in downstream stages.

import { complete } from '../anthropic';
import { loadStage0OrgIntakePrompt } from '../canon/loader';

export interface OrgExtractionInput {
  name: string;
  processedBrief: string;
  issueAreas?: string;
  defaultAsk?: string;
  materials?: string[]; // extractedText from ProjectMaterial records
}

export async function runOrgExtraction(
  input: OrgExtractionInput,
): Promise<string> {
  const systemPrompt = loadStage0OrgIntakePrompt();

  const parts: string[] = [];

  parts.push(`# SUBMITTED ORG MATERIALS`);
  parts.push(`## Mission / Scope Statement\n${input.processedBrief}`);
  parts.push(`## Issue Areas\n${input.issueAreas || 'Not provided'}`);
  parts.push(`## Default Ask\n${input.defaultAsk || 'Not provided'}`);

  if (input.materials?.length) {
    parts.push(`## Additional Materials\n${input.materials.join('\n\n---\n\n')}`);
  } else {
    parts.push(`## Additional Materials\nNone provided`);
  }

  const userMessage = parts.join('\n\n');

  const result = await complete(systemPrompt, userMessage, {
    maxTokens: 2000,
    temperature: 0,
  });

  return result;
}
