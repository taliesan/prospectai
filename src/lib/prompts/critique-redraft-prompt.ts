// STAGE 4b: Critique and Redraft Pass — added 2026-02-09
// Uses fictional exemplars from prompt-v2.txt + critique-editorial-v2.txt

import type { LinkedInData } from './extraction-prompt';
import { loadPromptV2, loadCritiqueEditorialV2 } from '../canon/loader';

export function buildCritiqueRedraftPrompt(
  donorName: string,
  firstDraftProfile: string,
  _geoffreyBlock: string,
  _exemplars: string,
  extractionOutput: string,
  linkedinData?: LinkedInData | null,
  factCheckBlock?: string,
  confidenceAuditBlock?: string,
): string {
  const promptV2 = loadPromptV2();
  const editorial = loadCritiqueEditorialV2();

  // Extract Register + Exemplars from prompt-v2.txt
  // Everything from "# 1. REGISTER" through the ═══ line before "# 3. CANONICAL"
  const registerStart = promptV2.indexOf('# 1. REGISTER');
  const exemplarEnd = promptV2.indexOf('# 3. CANONICAL BIOGRAPHICAL DATA');
  const registerAndExemplars = promptV2.substring(registerStart, exemplarEnd).trim();

  // Extract sections from editorial file
  const openingStart = editorial.indexOf('# OPENING');
  const voiceStart = editorial.indexOf('# VOICE STANDARD');
  const editorialStart = editorial.indexOf('# EDITORIAL INSTRUCTIONS');

  const opening = editorial.substring(
    editorial.indexOf('\n', openingStart) + 1,
    voiceStart
  ).trim();

  const voiceStandard = editorial.substring(
    voiceStart,
    editorialStart
  ).trim();

  const editorialInstructions = editorial.substring(editorialStart).trim();

  // Build canonical bio
  let canonicalBio = '';
  if (linkedinData) {
    canonicalBio = `**Current Position:** ${linkedinData.currentTitle} at ${linkedinData.currentEmployer}

**Career History:**
${linkedinData.careerHistory?.map(job => `- ${job.title} at ${job.employer} (${job.startDate} - ${job.endDate})`).join('\n') || 'Not available'}

**Education:**
${linkedinData.education?.map(edu => `- ${edu.institution}${edu.degree ? `: ${edu.degree}` : ''}${edu.field ? ` in ${edu.field}` : ''} (${edu.years})`).join('\n') || 'Not available'}

${linkedinData.boards?.length ? `**Board/Advisory Roles:**\n${linkedinData.boards.map(b => `- ${b}`).join('\n')}` : ''}`;
  } else {
    canonicalBio = 'No canonical biographical data available.';
  }

  // Assemble
  const parts: string[] = [
    opening,
    '---',
    registerAndExemplars,
    '---',
    voiceStandard,
    '---',
    `# CANONICAL BIOGRAPHICAL DATA\n\nUse this as the authoritative source for biographical facts.\n\n${canonicalBio}`,
    '---',
    `# BEHAVIORAL EVIDENCE\n\nThe following behavioral evidence was extracted from research sources about ${donorName}. Use it to verify claims in the first draft and identify unsupported assertions.\n\n${extractionOutput}`,
    '---',
    `# FIRST DRAFT\n\nThe following is the first draft of the Persuasion Profile for ${donorName}. Your job is to produce the final version by applying the editorial process described in the instructions below.\n\n${firstDraftProfile}`,
  ];

  if (factCheckBlock) {
    parts.push('---');
    parts.push(factCheckBlock);
    parts.push('IMPORTANT: The mandatory corrections above are your FIRST priority. Before applying any other editorial instruction, process every mandatory correction. Then proceed with editorial improvements on whatever remains.');
  }

  if (confidenceAuditBlock) {
    parts.push('---');
    parts.push(confidenceAuditBlock);
  }

  parts.push('---');
  parts.push(editorialInstructions);

  return parts.join('\n\n');
}
