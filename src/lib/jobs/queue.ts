import { prisma } from '../db';
import { logger } from '../logger';
import type { JobType, Prisma } from '@prisma/client';

/**
 * Durable job queue (PostgreSQL-backed).
 *
 * Jobs survive restarts, are deduplicated via unique `dedupeKey`, retried with
 * exponential backoff, and processed by `runner.ts` which is triggered:
 *  - fire-and-forget after order/payment events (`kickJobRunner`)
 *  - by an external cron hitting POST /api/cron/jobs (production reliability)
 *  - manually from the admin Fulfilment screen
 */

export interface EnqueueJobParams {
  type: JobType;
  payload: Prisma.InputJsonValue;
  dedupeKey?: string | null;
  runAt?: Date | null;
  maxAttempts?: number;
}

export async function enqueueJob(params: EnqueueJobParams): Promise<string | null> {
  try {
    const job = await prisma.job.create({
      data: {
        type: params.type,
        payload: params.payload,
        dedupeKey: params.dedupeKey ?? null,
        nextRunAt: params.runAt ?? new Date(),
        maxAttempts: params.maxAttempts ?? 6,
      },
    });
    return job.id;
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002' && params.dedupeKey) {
      // Already queued - dedupe working as intended.
      const existing = await prisma.job.findUnique({ where: { dedupeKey: params.dedupeKey } });
      if (existing && ['DONE', 'FAILED', 'CANCELLED'].includes(existing.status)) {
        // Previous run finished: requeue by resetting (keeps one row per dedupe key).
        await prisma.job.update({
          where: { id: existing.id },
          data: {
            status: 'PENDING',
            payload: params.payload,
            attempts: 0,
            lastError: null,
            nextRunAt: params.runAt ?? new Date(),
            completedAt: null,
          },
        });
        return existing.id;
      }
      return existing?.id ?? null;
    }
    logger.error('Failed to enqueue job', {
      type: params.type,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** Reschedule a job for a later poll (used by supplier-status polling). */
export async function rescheduleJob(jobId: string, runAt: Date): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'PENDING', nextRunAt: runAt, lockedAt: null },
  });
}

/**
 * Fire-and-forget runner trigger with an in-flight guard so bursts of events
 * don't spawn parallel runs inside the same process. Failures are logged, and
 * the cron endpoint remains the reliable backstop.
 */
let runnerInFlight: Promise<unknown> | null = null;

export function kickJobRunner(): void {
  if (runnerInFlight) return;
  runnerInFlight = (async () => {
    try {
      const { processDueJobs } = await import('./runner');
      await processDueJobs({ limit: 10 });
    } catch (err) {
      logger.error('Job runner kick failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      runnerInFlight = null;
    }
  })();
}
