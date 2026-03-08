// Stage 0 — Org Strategic Extraction
//
// Runs once per ProjectContext (on create/update, not per pipeline run).
// Converts raw org materials into a structured strategic frame
// that replaces raw org text in downstream stages.

import { complete } from '../anthropic';
import { loadStage0OrgIntakePrompt, loadTidebreakStrategicFrame } from '../canon/loader';
import { writeFileSync, mkdirSync } from 'fs';

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
  console.log(`[Stage 0] Running org extraction for "${input.name}"`);
  console.log(`[Stage 0] Input: processedBrief=${input.processedBrief?.length || 0} chars, issueAreas=${input.issueAreas?.length || 0} chars, defaultAsk=${input.defaultAsk?.length || 0} chars, materials=${input.materials?.length || 0} items`);

  const basePrompt = loadStage0OrgIntakePrompt();
  const tidebreakFrame = loadTidebreakStrategicFrame();

  // Insert the Tidebreak exemplar after the OUTPUT FORMAT closing fence and before EXTRACTION RULES
  const completeExample = `

## COMPLETE EXAMPLE

The following is a complete strategic frame at the target quality and register. Your output should match this structure, density, and tone.

${tidebreakFrame}

`;
  const systemPrompt = basePrompt.replace(
    '## EXTRACTION RULES',
    `${completeExample}## EXTRACTION RULES`,
  );

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
  console.log(`[Stage 0] Assembled input block: ${userMessage.length} chars`);
  console.log(`[Stage 0] Sending to model (prompt: ${systemPrompt.length} chars, input: ${userMessage.length} chars)...`);

  // Debug save prompt
  try {
    mkdirSync('/tmp/prospectai-outputs', { recursive: true });
    writeFileSync('/tmp/prospectai-outputs/DEBUG-stage-0-org-extraction-prompt.txt',
      `=== SYSTEM PROMPT (${systemPrompt.length} chars) ===\n\n${systemPrompt}\n\n=== USER MESSAGE (${userMessage.length} chars) ===\n\n${userMessage}`);
  } catch (e) { /* ignore */ }

  const result = await complete(systemPrompt, userMessage, {
    maxTokens: 2000,
    temperature: 0,
  });

  console.log(`[Stage 0] Received strategicFrame: ${result.length} chars`);
  console.log(`[Stage 0] First 200 chars: ${result.slice(0, 200)}`);

  // Debug save response
  try {
    writeFileSync('/tmp/prospectai-outputs/DEBUG-stage-0-org-extraction-response.txt', result);
  } catch (e) { /* ignore */ }

  return result;
}
