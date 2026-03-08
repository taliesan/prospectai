import type { LinkedInData } from './extraction-prompt';
import { loadPromptV2 } from '../canon/loader';

export function buildProfilePrompt(
  donorName: string,
  extractionOutput: string,
  _geoffreyBlock: string,
  _exemplars: string,
  linkedinData?: LinkedInData | null,
  confidencePromptBlock?: string,
): string {
  const template = loadPromptV2();

  // Build canonical bio section from linkedinData
  let canonicalBio = '';
  if (linkedinData) {
    canonicalBio = `**Current Position:** ${linkedinData.currentTitle} at ${linkedinData.currentEmployer}

**Career History:**
${linkedinData.careerHistory.map(job =>
  `- ${job.title} at ${job.employer} (${job.startDate} - ${job.endDate})`
).join('\n')}

**Education:**
${linkedinData.education.map(edu =>
  `- ${edu.institution}${edu.degree ? `: ${edu.degree}` : ''}${edu.field ? ` in ${edu.field}` : ''}${edu.years ? ` (${edu.years})` : ''}`
).join('\n')}

${linkedinData.boards?.length ? `**Board/Advisory Roles:**\n${linkedinData.boards.map(b => `- ${b}`).join('\n')}` : ''}`;
  } else {
    canonicalBio = 'No canonical biographical data available.';
  }

  // Two marker replacements
  let assembled = template
    .replace('[PIPELINE INJECTS CANONICAL BIO HERE]', canonicalBio)
    .replace('[PIPELINE INJECTS BEHAVIORAL DOSSIER HERE]', extractionOutput);

  // Replace [TARGET NAME] with actual donor name
  assembled = assembled.replaceAll('[TARGET NAME]', donorName);

  // Append confidence scoring instructions if provided
  if (confidencePromptBlock) {
    assembled += '\n\n---\n' + confidencePromptBlock;
  }

  return assembled;
}
