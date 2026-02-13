// In-memory job store for fire-and-poll pipeline architecture.
// Jobs are stored in a Map keyed by jobId. Railway runs persistent containers,
// so in-memory state survives across HTTP requests.

import { ProgressEvent } from './progress';

export interface Job {
  id: string;
  status: 'running' | 'complete' | 'failed';
  donorName: string;
  progressMessages: ProgressEvent[];
  currentPhase: string;
  currentStep: number;
  totalSteps: number;
  result?: any;
  error?: string;
  createdAt: number;
  lastPolledAt: number;
}

const jobs = new Map<string, Job>();

// Clean up jobs older than 30 minutes every 5 minutes
const JOB_TTL = 30 * 60 * 1000;
const CLEANUP_INTERVAL = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  jobs.forEach((job, id) => {
    if (now - job.createdAt > JOB_TTL) {
      jobs.delete(id);
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
  return job;
}

export function getJob(id: string): Job | undefined {
  const job = jobs.get(id);
  if (job) {
    job.lastPolledAt = Date.now();
  }
  return job;
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
