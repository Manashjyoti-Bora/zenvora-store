import { after } from 'next/server';
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

/**
 * Enqueue a job using the caller's Prisma transaction. Use this when the
 * originating domain write must not commit without durable work being queued
 * (for example, cancellation plus supplier-cancellation requests).
 *
 * A dedupe key is inserted with ON CONFLICT DO NOTHING semantics so duplicate
 * requests inside concurrent transactions do not abort the surrounding domain
 * transaction. Existing terminal jobs are reset using the same retry semantics
 * as enqueueJob, without leaving the caller's transaction.
 */
export async function enqueueJobInTransaction(
  tx: Prisma.TransactionClient,
  params: EnqueueJobParams
): Promise<void> {
  const data = {
    type: params.type,
    payload: params.payload,
    dedupeKey: params.dedupeKey ?? null,
    nextRunAt: params.runAt ?? new Date(),
    maxAttempts: params.maxAttempts ?? 6,
  };

  if (params.dedupeKey) {
    const inserted = await tx.job.createMany({ data: [data], skipDuplicates: true });
    if (inserted.count === 0) {
      const existing = await tx.job.findUnique({ where: { dedupeKey: params.dedupeKey } });
      if (existing && ['DONE', 'FAILED', 'CANCELLED'].includes(existing.status)) {
        await tx.job.updateMany({
          where: { id: existing.id, status: { in: ['DONE', 'FAILED', 'CANCELLED'] } },
          data: {
            status: 'PENDING',
            payload: params.payload,
            attempts: 0,
            lastError: null,
            nextRunAt: params.runAt ?? new Date(),
            lockedAt: null,
            claimToken: null,
            completedAt: null,
          },
        });
      }
    }
    return;
  }
  await tx.job.create({ data });
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
        await prisma.job.updateMany({
          where: { id: existing.id, status: { in: ['DONE', 'FAILED', 'CANCELLED'] } },
          data: {
            status: 'PENDING',
            payload: params.payload,
            attempts: 0,
            lastError: null,
            nextRunAt: params.runAt ?? new Date(),
            lockedAt: null,
            claimToken: null,
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
export async function rescheduleJob(
  jobId: string,
  runAt: Date,
  claimToken: string
): Promise<boolean> {
  if (!claimToken) return false;
  const result = await prisma.job.updateMany({
    where: { id: jobId, status: 'RUNNING', claimToken },
    data: { status: 'PENDING', nextRunAt: runAt, lockedAt: null, claimToken: null },
  });
  return result.count === 1;
}

/**
 * Fire-and-forget runner trigger with an in-flight guard so bursts of events
 * don't spawn parallel runs inside the same process. Failures are logged, and
 * the cron endpoint remains the reliable backstop.
 *
 * Serverless reliability: on Vercel the function is frozen as soon as the
 * HTTP response is sent, so a purely fire-and-forget kick usually never
 * finishes (this is why queued notification emails — e.g. password resets —
 * were enqueued but never processed in production). `after()` from next/server
 * registers the work in the platform's post-response window (waitUntil
 * semantics on Vercel), keeping the function alive until the kicked run
 * completes. Outside a request scope (scripts, tests, direct service calls)
 * after() throws — caught, and the in-flight promise keeps the previous
 * fire-and-forget behavior.
 */
let runnerInFlight: Promise<unknown> | null = null;

export function kickJobRunner(): void {
  if (runnerInFlight) return;
  const run = (async () => {
    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
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

  runnerInFlight = run;

  try {
    after(() => run);
  } catch {
    // preserve legacy fire-and-forget behavior outside request scope
  }
}
