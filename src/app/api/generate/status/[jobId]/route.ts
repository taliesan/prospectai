import { NextRequest } from 'next/server';
import { getJob } from '@/lib/job-store';

export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const { jobId } = params;
  const job = getJob(jobId);

  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 });
  }

  if (job.status === 'complete') {
    return Response.json({
      status: 'complete',
      result: job.result,
    });
  }

  if (job.status === 'failed') {
    return Response.json({
      status: 'failed',
      error: job.error,
    });
  }

  // Still running — return progress summary
  const latestMessage = job.progressMessages[job.progressMessages.length - 1];
  const milestones = job.progressMessages
    .filter(m => m.message.startsWith('\u2713'))
    .map(m => m.message);

  return Response.json({
    status: 'running',
    phase: job.currentPhase || undefined,
    step: job.currentStep,
    totalSteps: job.totalSteps,
    message: latestMessage?.message || 'Starting...',
    milestones,
  });
}
