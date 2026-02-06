// Progress event system for real-time updates to the frontend
// Uses AsyncLocalStorage for request-scoped callbacks (no global state)

import { AsyncLocalStorage } from 'async_hooks';

export type ProgressEvent = {
  type: 'status' | 'complete' | 'error';
  message: string;
  stage?: 'research' | 'dossier' | 'profile';
  detail?: string;
};

// Request-scoped storage for progress callbacks
const progressStore = new AsyncLocalStorage<(event: ProgressEvent) => void>();

/**
 * Run a function with a request-scoped progress callback.
 * All calls to emitProgress() within this context will use this callback.
 */
export function withProgressCallback<T>(
  callback: (event: ProgressEvent) => void,
  fn: () => T
): T {
  return progressStore.run(callback, fn);
}

export function emitProgress(event: ProgressEvent) {
  const callback = progressStore.getStore();
  if (callback) {
    callback(event);
  }
  // Also log to console for Railway logs
  const prefix = event.stage ? `[${event.stage.toUpperCase()}]` : '[Progress]';
  console.log(`${prefix} ${event.message}`);
}

// User-friendly status messages
export const STATUS = {
  // Research stage
  identityResolving: (name: string) => emitProgress({
    type: 'status',
    stage: 'research',
    message: `Identifying ${name}...`
  }),
  queriesGenerated: (count: number) => emitProgress({
    type: 'status',
    stage: 'research',
    message: `Searching ${count} research angles...`
  }),
  sourcesCollected: (count: number) => emitProgress({
    type: 'status',
    stage: 'research',
    message: `Found ${count} potential sources`
  }),
  researchComplete: (count: number) => emitProgress({
    type: 'status',
    stage: 'research',
    message: `✓ Research complete: ${count} sources`
  }),

  // Dossier stage
  tiersPrioritized: (t1: number, t2: number, t3: number, t4: number) => emitProgress({
    type: 'status',
    stage: 'dossier',
    message: `Prioritizing sources: ${t1} interviews/podcasts, ${t2} speeches/profiles, ${t3} news, ${t4} bios`
  }),
  processingTop: (count: number) => emitProgress({
    type: 'status',
    stage: 'dossier',
    message: `Analyzing top ${count} sources for behavioral patterns`
  }),
  batchStarted: (batchNum: number, start: number, end: number) => emitProgress({
    type: 'status',
    stage: 'dossier',
    message: `Extracting patterns from sources ${start}-${end}...`
  }),
  batchComplete: (batchNum: number, start: number, end: number) => emitProgress({
    type: 'status',
    stage: 'dossier',
    message: `✓ Analyzed sources ${start}-${end}`
  }),
  batchFailed: (batchNum: number, error: string) => emitProgress({
    type: 'status',
    stage: 'dossier',
    message: `⚠ Batch ${batchNum} had issues, continuing...`
  }),
  synthesizing: () => emitProgress({
    type: 'status',
    stage: 'dossier',
    message: `Synthesizing 17 behavioral dimensions...`
  }),
  crossCutting: () => emitProgress({
    type: 'status',
    stage: 'dossier',
    message: `Identifying contradictions and patterns...`
  }),
  dossierComplete: () => emitProgress({
    type: 'status',
    stage: 'dossier',
    message: `✓ Behavioral dossier complete`
  }),

  // Profile stage
  generatingDraft: () => emitProgress({
    type: 'status',
    stage: 'profile',
    message: `Writing profile draft...`
  }),
  validationAttempt: (attempt: number, max: number) => emitProgress({
    type: 'status',
    stage: 'profile',
    message: `Quality check ${attempt}/${max}...`
  }),
  validatorRunning: (name: string) => emitProgress({
    type: 'status',
    stage: 'profile',
    message: `Checking: ${name}...`
  }),
  validatorPassed: (name: string) => emitProgress({
    type: 'status',
    stage: 'profile',
    message: `✓ ${name}`
  }),
  validatorFailed: (name: string) => emitProgress({
    type: 'status',
    stage: 'profile',
    message: `⚠ ${name} needs improvement`
  }),
  regenerating: () => emitProgress({
    type: 'status',
    stage: 'profile',
    message: `Improving profile based on feedback...`
  }),
  profileComplete: () => emitProgress({
    type: 'status',
    stage: 'profile',
    message: `✓ Profile complete`
  }),
  profileShipping: () => emitProgress({
    type: 'status',
    stage: 'profile',
    message: `✓ Profile ready (some checks may need review)`
  }),

  // Pipeline
  pipelineStarted: (name: string) => emitProgress({
    type: 'status',
    message: `Starting profile generation for ${name}...`
  }),
  pipelineComplete: () => emitProgress({
    type: 'status',
    message: `✓ Pipeline complete, preparing results...`
  }),
  pipelineError: (error: string) => emitProgress({
    type: 'error',
    message: `Error: ${error}`
  })
};
