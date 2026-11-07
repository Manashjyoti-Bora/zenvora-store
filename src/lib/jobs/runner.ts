import { randomUUID } from 'node:crypto';
import { prisma } from '../db';
import { logger } from '../logger';
import { PermanentJobError } from './errors';
import { runJobHandler } from './handlers';
import type { Job, PrismaClient } from '@prisma/client';

/**
 * Durable, at-least-once job runner.
 *
 * Row locks prevent simultaneous claims of one pending row. A random token
 * fences state writes after a claim is recovered/replaced; a heartbeat keeps
 * legitimate long jobs from expiring. External handlers still need provider
 * idempotency because a process can die after an external side effect.
 */

export interface ProcessResult {
  claimed: number;
  succeeded: number;
  failed: number;
  retried: number;
  rescheduled: number;
}

export const JOB_STALE_LOCK_MS = 10 * 60_000;
export const JOB_LEASE_RENEW_INTERVAL_MS = 60_000;

function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** attempts, 30 * 60_000) + Math.floor(Math.random() * 5_000);
}

export async function processDueJobs(opts?: { limit?: number }): Promise<ProcessResult> {
  const limit = opts?.limit ?? 10;
  const stats: ProcessResult = { claimed: 0, succeeded: 0, failed: 0, retried: 0, rescheduled: 0 };

  const recovery = await recoverStaleLocks();
  stats.failed += recovery.failed;

  const jobs = await claimJobs(limit);
  stats.claimed = jobs.length;
  for (const job of jobs) await executeJob(job, stats);
  return stats;
}

/** Recover only leases still expired at update time; a concurrent heartbeat wins. */
export async function recoverStaleLocks(): Promise<{ recovered: number; failed: number }> {
  const expiredAt = new Date(Date.now() - JOB_STALE_LOCK_MS);
  const staleJobs = await prisma.job.findMany({
    where: {
      status: 'RUNNING',
      OR: [{ lockedAt: null }, { lockedAt: { lt: expiredAt } }],
    },
    orderBy: { lockedAt: 'asc' },
  });
  let recovered = 0;
  let failed = 0;

  for (const job of staleJobs) {
    const attempts = job.attempts + 1;
    const stillExpired = {
      id: job.id,
      status: 'RUNNING' as const,
      claimToken: job.claimToken,
      OR: [{ lockedAt: null }, { lockedAt: { lt: expiredAt } }],
    };

    if (job.type === 'CANCEL_SUPPLIER_ORDER') {
      const message =
        'Cancellation outcome is uncertain because the worker lease expired. Verify directly with the supplier; this job will not be retried automatically.';
      const result = await prisma.job.updateMany({
        where: stillExpired,
        data: {
          status: 'FAILED',
          attempts,
          lastError: message,
          lockedAt: null,
          claimToken: null,
        },
      });
      if (result.count === 1) {
        const payload = job.payload as Record<string, unknown>;
        if (typeof payload.supplierOrderId === 'string') {
          await prisma.supplierOrder.updateMany({
            where: {
              id: payload.supplierOrderId,
              cancellationStatus: { in: ['NONE', 'REQUESTED', 'SUBMITTING', 'REJECTED'] },
            },
            data: {
              cancellationStatus: 'MANUAL_ACTION_REQUIRED',
              cancellationMessage: message,
              lastError: message,
            },
          });
        }
        recovered += 1;
        failed += 1;
        await onJobFailed(job, message);
      }
      continue;
    }

    const message = 'Worker lease expired before the job completed; ownership was reclaimed.';
    if (attempts >= job.maxAttempts) {
      const result = await prisma.job.updateMany({
        where: stillExpired,
        data: {
          status: 'FAILED',
          attempts,
          lastError: message,
          lockedAt: null,
          claimToken: null,
        },
      });
      if (result.count === 1) {
        recovered += 1;
        failed += 1;
        await onJobFailed(job, message);
      }
      continue;
    }

    const delay = backoffMs(attempts);
    const result = await prisma.job.updateMany({
      where: stillExpired,
      data: {
        status: 'PENDING',
        attempts,
        nextRunAt: new Date(Date.now() + delay),
        lastError: message,
        lockedAt: null,
        claimToken: null,
      },
    });
    if (result.count === 1) recovered += 1;
  }

  if (recovered > 0) logger.warn('Recovered expired job leases', { recovered, failed });
  return { recovered, failed };
}

/** Claim due rows under PostgreSQL row locks and assign a fresh fencing token. */
export async function claimJobs(limit: number, db: PrismaClient = prisma): Promise<Job[]> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM jobs
      WHERE status = 'PENDING' AND "nextRunAt" <= NOW()
      ORDER BY "nextRunAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED`;
    if (rows.length === 0) return [];

    const claimedIds: string[] = [];
    for (const row of rows) {
      const claimed = await tx.job.updateMany({
        where: { id: row.id, status: 'PENDING' },
        data: { status: 'RUNNING', lockedAt: new Date(), claimToken: randomUUID() },
      });
      if (claimed.count === 1) claimedIds.push(row.id);
    }
    if (claimedIds.length === 0) return [];
    return tx.job.findMany({ where: { id: { in: claimedIds } }, orderBy: { nextRunAt: 'asc' } });
  });
}

interface LeaseHeartbeat {
  isLost(): boolean;
  stop(): Promise<void>;
}

function startLeaseHeartbeat(job: Job): LeaseHeartbeat {
  const claimToken = job.claimToken;
  let lost = !claimToken;
  let stopped = false;
  let renewal: Promise<void> | null = null;

  const renew = async () => {
    try {
      const result = await prisma.job.updateMany({
        where: { id: job.id, status: 'RUNNING', claimToken },
        data: { lockedAt: new Date() },
      });
      if (result.count !== 1) lost = true;
    } catch (error) {
      lost = true;
      logger.error('Could not renew job lease; worker will not write a result', {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const timer = setInterval(() => {
    if (stopped || lost || renewal) return;
    renewal = renew().finally(() => {
      renewal = null;
    });
  }, JOB_LEASE_RENEW_INTERVAL_MS);

  return {
    isLost: () => lost,
    async stop() {
      stopped = true;
      clearInterval(timer);
      if (renewal) await renewal;
    },
  };
}

async function updateWhileOwned(
  job: Job,
  data: Parameters<typeof prisma.job.updateMany>[0]['data']
): Promise<boolean> {
  if (!job.claimToken) return false;
  const result = await prisma.job.updateMany({
    where: { id: job.id, status: 'RUNNING', claimToken: job.claimToken },
    data: { ...data, lockedAt: null, claimToken: null },
  });
  if (result.count === 1) return true;
  logger.warn('Discarded job result from a worker that no longer owns the lease', {
    jobId: job.id,
    type: job.type,
  });
  return false;
}

export async function executeJob(job: Job, stats: ProcessResult): Promise<void> {
  if (!job.claimToken) {
    logger.error('Refusing to execute a job without a worker claim token', { jobId: job.id });
    return;
  }

  const lease = startLeaseHeartbeat(job);
  let result: Awaited<ReturnType<typeof runJobHandler>> | undefined = undefined;
  let handlerError: unknown;
  let handlerFailed = false;
  try {
    result = await runJobHandler(job);
  } catch (error) {
    handlerFailed = true;
    handlerError = error;
  }
  await lease.stop();
  if (lease.isLost()) return;

  if (handlerFailed) {
    const message = handlerError instanceof Error ? handlerError.message : String(handlerError);
    const permanent = handlerError instanceof PermanentJobError;
    const attempts = job.attempts + 1;

    if (permanent || attempts >= job.maxAttempts) {
      if (
        !(await updateWhileOwned(job, {
          status: 'FAILED',
          attempts,
          lastError: message.slice(0, 500),
        }))
      ) {
        return;
      }
      stats.failed += 1;
      await onJobFailed(job, message);
      return;
    }

    const delay = backoffMs(attempts);
    if (
      !(await updateWhileOwned(job, {
        status: 'PENDING',
        attempts,
        nextRunAt: new Date(Date.now() + delay),
        lastError: message.slice(0, 500),
      }))
    ) {
      return;
    }
    stats.retried += 1;
    logger.warn('Job failed, scheduled retry', {
      jobId: job.id,
      type: job.type,
      attempts,
      nextRetryInMs: delay,
      error: message,
    });
    return;
  }

  if (result && 'rescheduleAt' in result) {
    if (
      await updateWhileOwned(job, {
        status: 'PENDING',
        nextRunAt: result.rescheduleAt,
        ...(result.payload ? { payload: result.payload } : {}),
      })
    ) {
      stats.rescheduled += 1;
    }
  } else if (
    await updateWhileOwned(job, { status: 'DONE', completedAt: new Date(), lastError: null })
  ) {
    stats.succeeded += 1;
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
