// Evidence Grounding Validator
// Checks if profile claims are grounded in the research package

import { complete } from '../anthropic';

export interface ValidationResult {
  passed: boolean;
  failures: string[];
}

const EVIDENCE_VALIDATOR_PROMPT = `You are checking if profile claims are GROUNDED IN THE RESEARCH PACKAGE.

Every major claim in the profile should trace to evidence in the research package. This prevents hallucination.

For each major claim in the profile (core identity assertions, behavioral patterns, contradictions, preferences), check if supporting evidence exists in the research package.

Output format:

GROUNDED: "[claim]" — Supported by research evidence: "[brief evidence summary]"

UNGROUNDED: "[claim]" — No supporting evidence found in research package. This may be hallucinated or inferred without basis.

At the end:
- If ALL major claims are grounded: PASS
- If ANY claims are ungrounded: FAIL + list the ungrounded claims`;

export async function validateEvidence(profile: string, researchPackage: string): Promise<ValidationResult> {
  const prompt = `${EVIDENCE_VALIDATOR_PROMPT}

---

RESEARCH PACKAGE (source of truth):

${researchPackage.slice(0, 30000)}${researchPackage.length > 30000 ? '\n[Research package truncated...]' : ''}

---

PROFILE TO VALIDATE:

${profile}

---

Check each major claim in the profile against the research package. List GROUNDED and UNGROUNDED claims, then output final verdict: PASS if all grounded, FAIL if any ungrounded.`;

  try {
    const response = await complete(
      'You are a rigorous validator checking that profile claims are grounded in research package evidence.',
      prompt,
      { maxTokens: 3000 }
    );

    const trimmedResponse = response.trim();
    const upperResponse = trimmedResponse.toUpperCase();

    // Look for final verdict
    const lines = trimmedResponse.split('\n');
    const lastLines = lines.slice(-5).join('\n').toUpperCase();

    // Check for PASS at end or beginning
    if (lastLines.includes('PASS') || upperResponse.startsWith('PASS')) {
      // But verify there are no UNGROUNDED claims
      if (!upperResponse.includes('UNGROUNDED:')) {
        return { passed: true, failures: [] };
      }
    }

    // Extract UNGROUNDED claims
    const failures: string[] = [];
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.toUpperCase().startsWith('UNGROUNDED:') ||
          trimmedLine.toUpperCase().startsWith('UNGROUNDED ')) {
        failures.push(trimmedLine);
      }
    }

    // If we found ungrounded claims, it's a failure
    if (failures.length > 0) {
      return { passed: false, failures };
    }

    // Check for explicit FAIL
    if (upperResponse.includes('FAIL')) {
      return { passed: false, failures: [trimmedResponse] };
    }

    // If no UNGROUNDED claims found and response seems positive, pass
    if (upperResponse.includes('PASS') || upperResponse.includes('ALL') && upperResponse.includes('GROUNDED')) {
      return { passed: true, failures: [] };
    }

    // Default to pass if all claims appear grounded
    return { passed: true, failures: [] };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Evidence Validator] Error:', errorMessage);
    return {
      passed: false,
      failures: [`Validator error: ${errorMessage}`]
    };
  }
}
