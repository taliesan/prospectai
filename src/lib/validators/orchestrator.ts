// Validator Orchestrator
// Runs all 6 validators sequentially, aggregates results, determines if regeneration is needed

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
  console.log('[Validators] Running 6 validators sequentially...');

  const results: ValidationResult[] = [];

  try {
    console.log('[Validators] 1/6 Behavioral Focus...');
    const behavioralResult = await validateBehavioral(profile);
    results.push({ agent: 'Behavioral Focus', ...behavioralResult });
    console.log(`[Validators] Behavioral Focus: ${behavioralResult.passed ? '✓ PASS' : '✗ FAIL'}`);
  } catch (err) {
    console.error('[Validators] Behavioral Focus error:', err);
    results.push({ agent: 'Behavioral Focus', passed: false, failures: ['Validator error: ' + String(err)] });
  }

  try {
    console.log('[Validators] 2/6 Name-Swap Test...');
    const specificityResult = await validateSpecificity(profile);
    results.push({ agent: 'Name-Swap Test (Specificity)', ...specificityResult });
    console.log(`[Validators] Specificity: ${specificityResult.passed ? '✓ PASS' : '✗ FAIL'}`);
  } catch (err) {
    console.error('[Validators] Specificity error:', err);
    results.push({ agent: 'Name-Swap Test (Specificity)', passed: false, failures: ['Validator error: ' + String(err)] });
  }

  try {
    console.log('[Validators] 3/6 Contradiction...');
    const contradictionResult = await validateContradiction(profile);
    results.push({ agent: 'Contradiction', ...contradictionResult });
    console.log(`[Validators] Contradiction: ${contradictionResult.passed ? '✓ PASS' : '✗ FAIL'}`);
  } catch (err) {
    console.error('[Validators] Contradiction error:', err);
    results.push({ agent: 'Contradiction', passed: false, failures: ['Validator error: ' + String(err)] });
  }

  try {
    console.log('[Validators] 4/6 Retreat Patterns...');
    const retreatResult = await validateRetreat(profile);
    results.push({ agent: 'Retreat Patterns', ...retreatResult });
    console.log(`[Validators] Retreat: ${retreatResult.passed ? '✓ PASS' : '✗ FAIL'}`);
  } catch (err) {
    console.error('[Validators] Retreat Patterns error:', err);
    results.push({ agent: 'Retreat Patterns', passed: false, failures: ['Validator error: ' + String(err)] });
  }

  try {
    console.log('[Validators] 5/6 Evidence Grounding...');
    const evidenceResult = await validateEvidence(profile, dossier);
    results.push({ agent: 'Evidence Grounding', ...evidenceResult });
    console.log(`[Validators] Evidence: ${evidenceResult.passed ? '✓ PASS' : '✗ FAIL'}`);
  } catch (err) {
    console.error('[Validators] Evidence Grounding error:', err);
    results.push({ agent: 'Evidence Grounding', passed: false, failures: ['Validator error: ' + String(err)] });
  }

  try {
    console.log('[Validators] 6/6 Actionability...');
    const actionabilityResult = await validateActionability(profile);
    results.push({ agent: 'Actionability', ...actionabilityResult });
    console.log(`[Validators] Actionability: ${actionabilityResult.passed ? '✓ PASS' : '✗ FAIL'}`);
  } catch (err) {
    console.error('[Validators] Actionability error:', err);
    results.push({ agent: 'Actionability', passed: false, failures: ['Validator error: ' + String(err)] });
  }

  const allPassed = results.every(r => r.passed);

  const aggregatedFeedback = results
    .filter(r => !r.passed)
    .map(r => `## ${r.agent.toUpperCase()} FAILED:\n${r.failures.join('\n')}`)
    .join('\n\n');

  const passCount = results.filter(r => r.passed).length;
  console.log(`[Validators] Complete: ${passCount}/6 passed`);

  return { allPassed, results, aggregatedFeedback };
}
