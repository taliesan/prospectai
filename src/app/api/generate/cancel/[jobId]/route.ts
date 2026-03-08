import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import { cancelJob, getJob } from '@/lib/job-store';

export async function POST(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const { jobId } = params;
  const job = getJob(jobId);

  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 });
  }

  if (job.status !== 'running') {
    return Response.json({ status: job.status, message: 'Job is not running' });
  }

  // Cancel the job in our store (triggers abort controller)
  const result = cancelJob(jobId);

  // Also cancel the OpenAI background job if we have a responseId
  if (result?.responseId) {
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      await openai.responses.cancel(result.responseId);
      console.log(`[Job ${jobId}] OpenAI job ${result.responseId} cancelled`);
    } catch (err) {
      // Cancelling is best-effort — the job may have already completed
      console.warn(`[Job ${jobId}] Failed to cancel OpenAI job:`, err);
    }
  }

  console.log(`[Job ${jobId}] Cancelled by user`);

  return Response.json({ status: 'cancelled' });
}
