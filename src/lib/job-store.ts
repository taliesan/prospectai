// Job store with Postgres persistence and in-memory cache for real-time progress.
// The in-memory Map handles SSE streaming during generation.
// Postgres provides durable storage for job status and links to Profile records.

import { ProgressEvent } from './progress';
import { prisma } from './db';

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

// Clean up in-memory cache for finished jobs after 2 hours.
// Postgres is the source of truth for completed jobs.
// Running jobs are NEVER cleaned up from memory.
const CACHE_TTL = 2 * 60 * 60 * 1000;
const CLEANUP_INTERVAL = 10 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  jobs.forEach((job, id) => {
    if (job.status === 'running') return;
    if (now - job.lastPolledAt > CACHE_TTL) {
      jobs.delete(id);
      abortControllers.delete(id);
    }
  });
}, CLEANUP_INTERVAL);

export async function createJob(donorName: string, userId?: string): Promise<Job> {
  // Create in Postgres first to get a cuid
  let dbId: string | undefined;
  if (userId) {
    try {
      const dbJob = await prisma.job.create({
        data: { userId, donorName, status: 'running' },
      });
      dbId = dbJob.id;
    } catch (err) {
      console.warn('[JobStore] Failed to create Postgres job record:', err);
    }
  }

  const id = dbId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

/** Fetch a completed/failed job from Postgres when it's no longer in memory. */
export async function getJobFromDb(id: string): Promise<Job | undefined> {
  try {
    const dbJob = await prisma.job.findUnique({ where: { id } });
    if (!dbJob) return undefined;

    return {
      id: dbJob.id,
      status: dbJob.status as Job['status'],
      donorName: dbJob.donorName,
      progressMessages: [],
      currentPhase: '',
      currentStep: 0,
      totalSteps: 0,
      error: dbJob.error || undefined,
      createdAt: dbJob.startedAt.getTime(),
      lastPolledAt: Date.now(),
    };
  } catch {
    return undefined;
  }
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

/** Clear deep research activity data (e.g. when DR completes and Opus begins). */
export function clearActivity(id: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.activity = undefined;
}

export function completeJob(id: string, result: any): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'complete';
  job.result = result;

  // Persist to Postgres (fire-and-forget)
  prisma.job.update({
    where: { id },
    data: { status: 'complete', completedAt: new Date() },
  }).catch(() => { /* Postgres update failed — in-memory still has the result */ });
}

export function failJob(id: string, error: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'failed';
  job.error = error;

  // Persist to Postgres (fire-and-forget)
  prisma.job.update({
    where: { id },
    data: { status: 'failed', error, completedAt: new Date() },
  }).catch(() => { /* ignore */ });
}

/** Cancel a job. Returns the responseId (if any) so the caller can cancel the OpenAI job too. */
export function cancelJob(id: string): { responseId?: string } | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;

  job.status = 'cancelled';

  const controller = abortControllers.get(id);
  if (controller && !controller.signal.aborted) {
    controller.abort();
  }

  // Persist to Postgres (fire-and-forget)
  prisma.job.update({
    where: { id },
    data: { status: 'cancelled', completedAt: new Date() },
  }).catch(() => { /* ignore */ });

  return { responseId: job.responseId };
}

/** Link a completed Job to its Profile record in Postgres. */
export async function linkJobToProfile(jobId: string, profileId: string): Promise<void> {
  try {
    await prisma.job.update({
      where: { id: jobId },
      data: { profileId },
    });
  } catch (err) {
    console.warn(`[JobStore] Failed to link job ${jobId} to profile ${profileId}:`, err);
  }
}
