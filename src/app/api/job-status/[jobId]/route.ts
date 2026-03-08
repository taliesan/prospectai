import { NextRequest } from 'next/server';
import { getJob } from '@/lib/job-store';

/**
 * SSE endpoint for real-time job progress.
 * Polls the in-memory job store every 2s and pushes changes to the client.
 * Sends a heartbeat comment (:\n\n) every 15s to keep Railway from killing
 * the connection on idle timeout.
 *
 * Frontend should open this with EventSource and fall back to polling
 * /api/generate/status/[jobId] if the connection drops.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const { jobId } = params;

  // Quick 404 before opening the stream
  const initial = getJob(jobId);
  if (!initial) {
    return Response.json({ error: 'Job not found' }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const HEARTBEAT_MS = 15_000;
      const POLL_MS = 2_000;
      const MAX_DURATION_MS = 50 * 60 * 1000; // 50-minute safety cap
      const openedAt = Date.now();
      let lastHash = '';

      function send(data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { /* client gone */ }
      }

      const heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`:\n\n`));
        } catch { /* client gone */ }
      }, HEARTBEAT_MS);

      try {
        while (!closed && !request.signal.aborted) {
          if (Date.now() - openedAt > MAX_DURATION_MS) {
            send({ type: 'error', message: 'Stream timed out' });
            break;
          }

          const job = getJob(jobId);
          if (!job) {
            send({ type: 'error', message: 'Job expired' });
            break;
          }

          if (job.status === 'complete') {
            send({ type: 'complete', result: job.result });
            break;
          }
          if (job.status === 'failed') {
            send({ type: 'error', message: job.error || 'Job failed' });
            break;
          }
          if (job.status === 'cancelled') {
            send({ type: 'cancelled' });
            break;
          }

          // Still running — send progress snapshot (only when changed)
          const latestMsg = job.progressMessages[job.progressMessages.length - 1];
          const milestones = job.progressMessages
            .filter(m => m.message.startsWith('\u2713'))
            .map(m => m.message);

          const snapshot = {
            type: 'progress',
            phase: job.currentPhase || undefined,
            step: job.currentStep,
            totalSteps: job.totalSteps,
            message: latestMsg?.message || 'Starting...',
            milestones,
            activity: job.activity || undefined,
          };

          const hash = JSON.stringify(snapshot);
          if (hash !== lastHash) {
            lastHash = hash;
            send(snapshot);
          }

          await new Promise(resolve => setTimeout(resolve, POLL_MS));
        }
      } finally {
        clearInterval(heartbeatTimer);
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
