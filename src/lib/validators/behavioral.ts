// Behavioral Focus Validator
// Checks if profile bullets describe BEHAVIOR or TRAITS

import { complete } from '../anthropic';

export interface ValidationResult {
  passed: boolean;
  failures: string[];
}

const BEHAVIORAL_VALIDATOR_PROMPT = `You are checking if profile bullets describe BEHAVIOR or TRAITS.

BEHAVIOR = What they DO in specific situations
- "When someone presents a polished narrative, she probes for the messy parts"
- "If pushed on operational ambiguity, his 'simplicity' value becomes a weapon"

TRAIT = Who they ARE (generic descriptions)
- "Is thoughtful and strategic"
- "Values collaboration"
- "Cares about social justice"

Review each bullet in the profile. For any bullet that describes a TRAIT rather than BEHAVIOR, output:

FAIL: [Section X, Bullet Y] "[quoted text]" — This describes a trait, not behavior. Should describe what they DO when [situation].

If ALL bullets describe behavior, output: PASS`;

export async function validateBehavioral(profile: string): Promise<ValidationResult> {
  const prompt = `${BEHAVIORAL_VALIDATOR_PROMPT}

---

PROFILE TO VALIDATE:

${profile}

---

Review each bullet. Output PASS if all bullets describe behavior, or list each FAIL with the format specified above.`;

  try {
    const response = await complete(
      'You are a rigorous validator checking if profile bullets describe behavior rather than traits.',
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
    console.error('[Behavioral Validator] Error:', errorMessage);
    return {
      passed: false,
      failures: [`Validator error: ${errorMessage}`]
    };
  }
}
