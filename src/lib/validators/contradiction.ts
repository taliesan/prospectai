// Contradiction Validator
// Checks if the profile surfaces a substantive contradiction

import { complete } from '../anthropic';

export interface ValidationResult {
  passed: boolean;
  failures: string[];
}

const CONTRADICTION_VALIDATOR_PROMPT = `You are checking if the profile surfaces a SUBSTANTIVE CONTRADICTION.

A substantive contradiction is:
- A tension between STATED VALUES and REVEALED BEHAVIOR
- Specific to this donor (not generic hypocrisy)
- Creates leverage for persuasion (shows where they can be moved)

GOOD CONTRADICTION:
"His core contradiction is transparency vs. exposure — he prefers to be open even when vulnerable, but expects reciprocity. When someone names their own uncertainty, he engages fully. When someone performs vulnerability without stakes, he shuts the door quietly."

BAD/MISSING:
- No contradiction mentioned
- Generic contradiction ("says one thing, does another")
- Contradiction stated but not made operational (no guidance on how to use it)

Review the profile. Find and quote the core contradiction. Then evaluate:

1. Is it specific to this donor? (not generic hypocrisy)
2. Is it grounded in evidence? (stated values AND revealed behavior both shown)
3. Is it made operational? (tells the asker how to navigate it)

If all three: PASS + quote the contradiction
If any fail: FAIL + explain what's missing
If no contradiction found: FAIL — MISSING CONTRADICTION. The profile lacks any substantive tension between stated values and revealed behavior.`;

export async function validateContradiction(profile: string): Promise<ValidationResult> {
  const prompt = `${CONTRADICTION_VALIDATOR_PROMPT}

---

PROFILE TO VALIDATE:

${profile}

---

Find and evaluate the core contradiction. Output PASS with the quoted contradiction if it meets all criteria, or FAIL with explanation of what's missing.`;

  try {
    const response = await complete(
      'You are a rigorous validator checking for substantive contradictions in donor profiles.',
      prompt,
      { maxTokens: 1500 }
    );

    const trimmedResponse = response.trim();
    const upperResponse = trimmedResponse.toUpperCase();

    // Check if it passed
    if (upperResponse.startsWith('PASS')) {
      return { passed: true, failures: [] };
    }

    // Check for explicit FAIL
    if (upperResponse.startsWith('FAIL') || upperResponse.includes('MISSING CONTRADICTION')) {
      return { passed: false, failures: [trimmedResponse] };
    }

    // Look for failure indicators in the response
    const failureIndicators = [
      'not specific',
      'too generic',
      'not operational',
      'no contradiction',
      'missing',
      'lacks',
      'doesn\'t include',
      'does not include',
      'should include'
    ];

    for (const indicator of failureIndicators) {
      if (trimmedResponse.toLowerCase().includes(indicator)) {
        return { passed: false, failures: [trimmedResponse] };
      }
    }

    // If response contains "PASS" anywhere (case-insensitive), treat as pass
    if (upperResponse.includes('PASS')) {
      return { passed: true, failures: [] };
    }

    // Default to failure if unclear
    return { passed: false, failures: [trimmedResponse] };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Contradiction Validator] Error:', errorMessage);
    return {
      passed: false,
      failures: [`Validator error: ${errorMessage}`]
    };
  }
}
