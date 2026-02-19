// In-memory job store for fire-and-poll pipeline architecture.
// Jobs are stored in a Map keyed by jobId. Railway runs persistent containers,
// so in-memory state survives across HTTP requests.

import { ProgressEvent } from './progress';

export interface DeepResearchActivity {
  openaiStatus: string;       // raw: queued, in_progress, completed, failed, incomplete
  totalOutputItems: number;
  searches: number;
  pageVisits: number;
  reasoningSteps: number;
  codeExecutions: number;
  recentSearchQueries: string[];
  reasoningSummary: string[];
  hasMessage: boolean;
  elapsedSeconds: number;
}

export type ActivityCallback = (activity: DeepResearchActivity, responseId: string) => void;

export interface Job {
  id: string;
  status: 'running' | 'complete' | 'failed' | 'cancelled';
  donorName: string;
  progressMessages: ProgressEvent[];
  currentPhase: string;
  currentStep: number;
  totalSteps: number;
  result?: any;
  error?: string;
  createdAt: number;
  lastPolledAt: number;
  responseId?: string;
  activity?: DeepResearchActivity;
}

const jobs = new Map<string, Job>();
const abortControllers = new Map<string, AbortController>();

// Clean up jobs older than 30 minutes every 5 minutes
const JOB_TTL = 30 * 60 * 1000;
const CLEANUP_INTERVAL = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  jobs.forEach((job, id) => {
    if (now - job.createdAt > JOB_TTL) {
      jobs.delete(id);
      abortControllers.delete(id);
    }
  });
}, CLEANUP_INTERVAL);

export function createJob(donorName: string): Job {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job: Job = {
    id,
    status: 'running',
    donorName,
    progressMessages: [],
    currentPhase: '',
    currentStep: 0,
    totalSteps: 38,
    createdAt: Date.now(),
    lastPolledAt: Date.now(),
  };
  jobs.set(id, job);

  // Create an abort controller for this job (for user-initiated cancellation)
  const controller = new AbortController();
  abortControllers.set(id, controller);

  return job;
}

export function getJob(id: string): Job | undefined {
  const job = jobs.get(id);
  if (job) {
    job.lastPolledAt = Date.now();
  }
  return job;
}

export function getAbortSignal(id: string): AbortSignal | undefined {
  return abortControllers.get(id)?.signal;
}

export function addProgress(id: string, event: ProgressEvent): void {
  const job = jobs.get(id);
  if (!job) return;

  if (event.type === 'phase') {
    job.currentPhase = event.phase || '';
  } else if (event.type === 'status') {
    job.progressMessages.push(event);
    if (event.phase) job.currentPhase = event.phase;
    if (event.step) job.currentStep = event.step;
    if (event.totalSteps) job.totalSteps = event.totalSteps;
  } else if (event.type === 'error') {
    job.progressMessages.push(event);
  }
}

export function updateActivity(id: string, responseId: string, activity: DeepResearchActivity): void {
  const job = jobs.get(id);
  if (!job) return;
  job.responseId = responseId;
  job.activity = activity;
}

export function completeJob(id: string, result: any): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'complete';
  job.result = result;
}

export function failJob(id: string, error: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'failed';
  job.error = error;
}

/** Cancel a job. Returns the responseId (if any) so the caller can cancel the OpenAI job too. */
export function cancelJob(id: string): { responseId?: string } | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;

  job.status = 'cancelled';

  // Trigger the abort controller to stop the pipeline
  const controller = abortControllers.get(id);
  if (controller && !controller.signal.aborted) {
    controller.abort();
  }

  return { responseId: job.responseId };
}
