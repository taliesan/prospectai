// Name-Swap Test Validator (Specificity)
// Checks if profile bullets are specific to this donor or could apply to anyone

import { complete } from '../anthropic';

export interface ValidationResult {
  passed: boolean;
  failures: string[];
}

const SPECIFICITY_VALIDATOR_PROMPT = `You are running the NAME-SWAP TEST on a donor profile.

For each bullet, ask: "If I replaced this donor's name with a different wealthy philanthropist, would this bullet still be plausibly true?"

FAILS NAME-SWAP (too generic):
- "Cares deeply about democracy" (could be anyone)
- "Values transparency" (could be anyone)
- "Is motivated by making an impact" (could be anyone)

PASSES NAME-SWAP (specific to this donor):
- "His core contradiction is that he built wealth in systems he now critiques — he navigates this by funding structural change while avoiding personal exposure"
- "When the conversation stays abstract, she redirects to specific examples from her Canva experience"

Review each bullet. For any that could apply to a generic donor, output:

FAIL: [Section X, Bullet Y] "[quoted text]" — Too generic. This could describe any philanthropist. Should include [specific detail about THIS donor].

If ALL bullets are donor-specific, output: PASS`;

export async function validateSpecificity(profile: string): Promise<ValidationResult> {
  const prompt = `${SPECIFICITY_VALIDATOR_PROMPT}

---

PROFILE TO VALIDATE:

${profile}

---

Review each bullet using the name-swap test. Output PASS if all bullets are donor-specific, or list each FAIL with the format specified above.`;

  try {
    const response = await complete(
      'You are a rigorous validator running the name-swap test on profile bullets.',
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
    console.error('[Specificity Validator] Error:', errorMessage);
    return {
      passed: false,
      failures: [`Validator error: ${errorMessage}`]
    };
  }
}
