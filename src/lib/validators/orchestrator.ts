// Validator Orchestrator
// Runs all 6 validators in parallel, aggregates results, determines if regeneration is needed

import { validateBehavioral } from './behavioral';
import { validateSpecificity } from './specificity';
import { validateContradiction } from './contradiction';
import { validateRetreat } from './retreat';
import { validateEvidence } from './evidence';
import { validateActionability } from './actionability';

export interface ValidationResult {
  agent: string;
  passed: boolean;
  failures: string[];
}

export interface OrchestratorResult {
  allPassed: boolean;
  results: ValidationResult[];
  aggregatedFeedback: string;
}

export async function runAllValidators(
  profile: string,
  dossier: string
): Promise<OrchestratorResult> {
  console.log('[Validators] Running all 6 validators in parallel...');

  // Run all 6 validators in parallel (they're independent)
  const [
    behavioralResult,
    specificityResult,
    contradictionResult,
    retreatResult,
    evidenceResult,
    actionabilityResult
  ] = await Promise.all([
    validateBehavioral(profile),
    validateSpecificity(profile),
    validateContradiction(profile),
    validateRetreat(profile),
    validateEvidence(profile, dossier),
    validateActionability(profile),
  ]);

  // Package results with agent names
  const results: ValidationResult[] = [
    { agent: 'Behavioral Focus', ...behavioralResult },
    { agent: 'Name-Swap Test (Specificity)', ...specificityResult },
    { agent: 'Contradiction', ...contradictionResult },
    { agent: 'Retreat Patterns', ...retreatResult },
    { agent: 'Evidence Grounding', ...evidenceResult },
    { agent: 'Actionability', ...actionabilityResult },
  ];

  // Log results
  for (const r of results) {
    const status = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`[Validators] ${r.agent}: ${status}`);
    if (!r.passed && r.failures.length > 0) {
      console.log(`[Validators]   Failures: ${r.failures.length}`);
    }
  }

  const allPassed = results.every(r => r.passed);

  // Aggregate failures into regeneration prompt
  const aggregatedFeedback = results
    .filter(r => !r.passed)
    .map(r => `## ${r.agent.toUpperCase()} FAILED:\n${r.failures.join('\n')}`)
    .join('\n\n');

  console.log(`[Validators] Overall: ${allPassed ? 'ALL PASSED' : 'SOME FAILED'}`);

  return { allPassed, results, aggregatedFeedback };
}
