// Retreat Pattern Validator
// Checks if the profile explains how the donor signals disengagement

import { complete } from '../anthropic';

export interface ValidationResult {
  passed: boolean;
  failures: string[];
}

const RETREAT_VALIDATOR_PROMPT = `You are checking if the profile explains RETREAT PATTERNS.

Retreat patterns answer:
- How does this donor signal disengagement?
- What triggers their withdrawal?
- What are the observable tells that they're checking out?
- Can you recover, and how?

GOOD RETREAT PATTERN:
"When pushed on operational ambiguity, her 'simplicity' value becomes a weapon. She'll reframe your complexity as design failure rather than engage with legitimate uncertainty. Tell: She starts asking 'why' questions that are actually statements. Recovery: Don't defend the complexity. Ask her how Canva simplified a specific analogous challenge."

MISSING/WEAK:
- No mention of how they disengage
- Vague statements like "may become disengaged if..."
- No observable tells
- No recovery guidance

Review the profile for retreat patterns. Quote any you find. Then evaluate:

1. Are withdrawal TRIGGERS identified?
2. Are observable TELLS described?
3. Is RECOVERY guidance provided?

If all three present: PASS + quote the pattern
If any missing: FAIL + explain what's needed
If no retreat patterns found: FAIL — MISSING RETREAT PATTERNS. I don't know how this donor signals disengagement.`;

export async function validateRetreat(profile: string): Promise<ValidationResult> {
  const prompt = `${RETREAT_VALIDATOR_PROMPT}

---

PROFILE TO VALIDATE:

${profile}

---

Find and evaluate retreat patterns. Output PASS with quoted patterns if all criteria are met, or FAIL with explanation of what's missing.`;

  try {
    const response = await complete(
      'You are a rigorous validator checking for explicit retreat patterns in donor profiles.',
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
    if (upperResponse.startsWith('FAIL') || upperResponse.includes('MISSING RETREAT')) {
      return { passed: false, failures: [trimmedResponse] };
    }

    // Look for failure indicators in the response
    const failureIndicators = [
      'no retreat',
      'missing',
      'not identified',
      'no observable',
      'no recovery',
      'lacks',
      'doesn\'t include',
      'does not include',
      'should include',
      'vague',
      'unclear'
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
    console.error('[Retreat Validator] Error:', errorMessage);
    return {
      passed: false,
      failures: [`Validator error: ${errorMessage}`]
    };
  }
}
