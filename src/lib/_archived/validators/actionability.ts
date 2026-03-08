// Actionability Validator
// Checks if profile bullets tell the asker what to DO

import { complete } from '../anthropic';

export interface ValidationResult {
  passed: boolean;
  failures: string[];
}

const ACTIONABILITY_VALIDATOR_PROMPT = `You are checking if profile bullets are ACTIONABLE.

Actionable = The asker knows what to DO differently after reading this bullet.

ACTIONABLE:
- "Start by naming the tension. Opening with the brittle part of the strategy signals you aren't selling him a story." → Asker knows: lead with problems, not polish
- "If they defend their original frame, he classifies them as inflexible." → Asker knows: show flexibility when he introduces constraints

NOT ACTIONABLE:
- "Values transparency" → Asker doesn't know what to DO
- "Is thoughtful about these issues" → Observational, not directive
- "Has complex views on philanthropy" → Description, not guidance

Review each bullet. For any that are purely observational without implied action, output:

FAIL: [Section X, Bullet Y] "[quoted text]" — Observational only. Should tell asker what to DO (e.g., "When X happens, do Y" or "Avoid Z because...")

If ALL bullets are actionable: PASS`;

export async function validateActionability(profile: string): Promise<ValidationResult> {
  const prompt = `${ACTIONABILITY_VALIDATOR_PROMPT}

---

PROFILE TO VALIDATE:

${profile}

---

Review each bullet. Output PASS if all bullets are actionable, or list each FAIL with the format specified above.`;

  try {
    const response = await complete(
      'You are a rigorous validator checking if profile bullets are actionable.',
      prompt,
      { maxTokens: 2000 }
    );

    const trimmedResponse = response.trim();

    // Check if it passed
    if (trimmedResponse.toUpperCase().startsWith('PASS')) {
      return { passed: true, failures: [] };
    }

    // Extract all FAIL lines
    const failures: string[] = [];
    const lines = trimmedResponse.split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.toUpperCase().startsWith('FAIL:') || trimmedLine.toUpperCase().startsWith('FAIL ')) {
        failures.push(trimmedLine);
      }
    }

    // If no explicit PASS and we found failures, it failed
    if (failures.length > 0) {
      return { passed: false, failures };
    }

    // If response doesn't clearly indicate PASS or have FAIL lines,
    // treat any substantive response as potential failure feedback
    if (trimmedResponse.length > 10 && !trimmedResponse.toUpperCase().includes('PASS')) {
      return { passed: false, failures: [trimmedResponse] };
    }

    // Default to fail if we can't determine - require explicit PASS
    return { passed: false, failures: ['Validator could not determine clear PASS. Response: ' + trimmedResponse.slice(0, 200)] };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Actionability Validator] Error:', errorMessage);
    return {
      passed: false,
      failures: [`Validator error: ${errorMessage}`]
    };
  }
}
