import { prisma } from '../db';
import { logger } from '../logger';
import { PermanentJobError } from './errors';
import { runJobHandler } from './handlers';
import type { Job } from '@prisma/client';

/**
 * Durable job runner.
 *
 * - Claims due jobs atomically with `FOR UPDATE SKIP LOCKED`, so it is safe
 *   even if more than one worker/process runs it concurrently.
 * - Transient failures: exponential backoff with jitter (30s * 2^n, capped at
 *   30 min), up to maxAttempts.
 * - Permanent failures: fail immediately and run the domain failure hook
 *   (e.g. mark the order FULFILMENT_FAILED and alert the admin).
 * - Crashed workers: RUNNING jobs locked for >10 minutes are recovered.
 */

export interface ProcessResult {
  claimed: number;
  succeeded: number;
  failed: number;
  retried: number;
  rescheduled: number;
}

const STALE_LOCK_MS = 10 * 60_000;

export async function processDueJobs(opts?: { limit?: number }): Promise<ProcessResult> {
  const limit = opts?.limit ?? 10;
  const stats: ProcessResult = { claimed: 0, succeeded: 0, failed: 0, retried: 0, rescheduled: 0 };

  await recoverStaleLocks();

  const jobs = await claimJobs(limit);
  stats.claimed = jobs.length;

  for (const job of jobs) {
    await executeJob(job, stats);
  }
  return stats;
}

async function recoverStaleLocks(): Promise<void> {
  const res = await prisma.job.updateMany({
    where: { status: 'RUNNING', lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } },
    data: { status: 'PENDING', lockedAt: null },
  });
  if (res.count > 0) {
    logger.warn('Recovered stale RUNNING jobs after worker crash/timeout', { count: res.count });
  }
}

async function claimJobs(limit: number): Promise<Job[]> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM jobs
      WHERE status = 'PENDING' AND "nextRunAt" <= NOW()
      ORDER BY "nextRunAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED`;
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    await tx.job.updateMany({
      where: { id: { in: ids } },
      data: { status: 'RUNNING', lockedAt: new Date() },
    });
    return tx.job.findMany({ where: { id: { in: ids } }, orderBy: { nextRunAt: 'asc' } });
  });
}

async function executeJob(job: Job, stats: ProcessResult): Promise<void> {
  try {
    const result = await runJobHandler(job);
    if (result && 'rescheduleAt' in result) {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: 'PENDING',
          nextRunAt: result.rescheduleAt,
          lockedAt: null,
          ...(result.payload ? { payload: result.payload } : {}),
        },
      });
      stats.rescheduled += 1;
    } else {
      await prisma.job.update({
        where: { id: job.id },
        data: { status: 'DONE', completedAt: new Date(), lockedAt: null, lastError: null },
      });
      stats.succeeded += 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const permanent = err instanceof PermanentJobError;
    const attempts = job.attempts + 1;

    if (permanent || attempts >= job.maxAttempts) {
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          attempts,
          lastError: message.slice(0, 500),
          lockedAt: null,
        },
      });
      stats.failed += 1;
      await onJobFailed(job, message);
    } else {
      const backoff =
        Math.min(30_000 * 2 ** attempts, 30 * 60_000) + Math.floor(Math.random() * 5_000);
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: 'PENDING',
          attempts,
          nextRunAt: new Date(Date.now() + backoff),
          lastError: message.slice(0, 500),
          lockedAt: null,
        },
      });
      stats.retried += 1;
      logger.warn('Job failed, scheduled retry', {
        jobId: job.id,
        type: job.type,
        attempts,
        nextRetryInMs: backoff,
        error: message,
      });
    }
  }
}

/** Domain-level failure hooks (run once, when a job fails permanently). */
async function onJobFailed(job: Job, message: string): Promise<void> {
  const payload = job.payload as Record<string, unknown>;
  try {
    if (job.type === 'FULFIL_SUPPLIER_ORDER') {
      const { handleFulfilmentFailure } = await import('../orders/fulfilment');
      await handleFulfilmentFailure(String(payload.supplierOrderId), message);
    } else if (job.type === 'CANCEL_SUPPLIER_ORDER') {
      logger.error('Supplier cancellation ultimately failed - manual action required', {
        supplierOrderId: String(payload.supplierOrderId),
        error: message,
      });
    } else if (job.type === 'SEND_NOTIFICATION') {
      // dispatchNotification already records FAILED on the notification row.
      logger.error('Notification delivery ultimately failed', {
        notificationId: String(payload.notificationId),
        error: message,
      });
    }
  } catch (hookErr) {
    logger.error('Job failure hook errored', {
      jobId: job.id,
      error: hookErr instanceof Error ? hookErr.message : String(hookErr),
    });
  }
}
