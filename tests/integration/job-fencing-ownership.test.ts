import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { ProcessResult } from '@/lib/jobs/runner';
import {
  executeJob,
  JOB_LEASE_RENEW_INTERVAL_MS,
  JOB_STALE_LOCK_MS,
  recoverStaleLocks,
} from '@/lib/jobs/runner';
import { runJobHandler } from '@/lib/jobs/handlers';
import { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import { unique } from './fixtures';

vi.mock('@/lib/jobs/handlers', () => ({
  runJobHandler: vi.fn(),
}));

describe('worker fencing ownership (independent PostgreSQL clients)', () => {
  const createdIds: string[] = [];
  const firstClient = new PrismaClient();
  const secondClient = new PrismaClient();

  afterEach(async () => {
    await prisma.job.deleteMany({ where: { id: { in: createdIds } } });
    createdIds.length = 0;
    vi.mocked(runJobHandler).mockReset();
  });

  afterAll(async () => {
    await Promise.allSettled([firstClient.$disconnect(), secondClient.$disconnect()]);
  });

  it('discards a stale worker result and lets the newer claim complete', async () => {
    await Promise.all([firstClient.$connect(), secondClient.$connect()]);
    const dedupeKey = `itest:${unique('ownership-fence')}`;
    const created = await prisma.job.create({
      data: {
        type: 'SEND_NOTIFICATION',
        payload: { notificationId: 'fencing-ownership-test' },
        dedupeKey,
        status: 'RUNNING',
        claimToken: 'old-claim-token',
        lockedAt: new Date(),
      },
    });
    createdIds.push(created.id);

    let announceStarted!: () => void;
    let releaseOldWorker!: () => void;
    const oldHandlerStarted = new Promise<void>((resolve) => {
      announceStarted = resolve;
    });
    const waitForOldHandler = new Promise<void>((resolve) => {
      releaseOldWorker = resolve;
    });
    vi.mocked(runJobHandler).mockImplementationOnce(async () => {
      announceStarted();
      await waitForOldHandler;
      return undefined;
    });

    const oldJob = await firstClient.job.findUniqueOrThrow({ where: { id: created.id } });
    const oldStats: ProcessResult = {
      claimed: 1,
      succeeded: 0,
      failed: 0,
      retried: 0,
      rescheduled: 0,
    };
    const oldExecution = executeJob(oldJob, oldStats);
    await oldHandlerStarted;

    const replaced = await secondClient.job.updateMany({
      where: { id: created.id, status: 'RUNNING', claimToken: 'old-claim-token' },
      data: { claimToken: 'new-claim-token', lockedAt: new Date() },
    });
    expect(replaced.count).toBe(1);
    const newJob = await secondClient.job.findUniqueOrThrow({ where: { id: created.id } });

    releaseOldWorker();
    await oldExecution;
    const afterStaleCompletion = await secondClient.job.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(afterStaleCompletion.status).toBe('RUNNING');
    expect(afterStaleCompletion.claimToken).toBe('new-claim-token');
    expect(oldStats.succeeded).toBe(0);

    vi.mocked(runJobHandler).mockImplementationOnce(async () => undefined);
    const newStats: ProcessResult = {
      claimed: 1,
      succeeded: 0,
      failed: 0,
      retried: 0,
      rescheduled: 0,
    };
    await executeJob(newJob, newStats);

    const completed = await secondClient.job.findUniqueOrThrow({ where: { id: created.id } });
    expect(completed.status).toBe('DONE');
    expect(completed.claimToken).toBeNull();
    expect(completed.lockedAt).toBeNull();
    expect(newStats.succeeded).toBe(1);
  }, 30_000);

  it('heartbeats keep a legitimate active claim from stale-lease recovery', async () => {
    await Promise.all([firstClient.$connect(), secondClient.$connect()]);
    const dedupeKey = `itest:${unique('heartbeat-fence')}`;
    const originalLock = new Date(Date.now() - JOB_STALE_LOCK_MS - 1_000);
    const created = await prisma.job.create({
      data: {
        type: 'SEND_NOTIFICATION',
        payload: { notificationId: 'heartbeat-fencing-test' },
        dedupeKey,
        status: 'RUNNING',
        claimToken: 'heartbeat-claim-token',
        lockedAt: originalLock,
      },
    });
    createdIds.push(created.id);

    let announceStarted!: () => void;
    let releaseHandler!: () => void;
    const handlerStarted = new Promise<void>((resolve) => {
      announceStarted = resolve;
    });
    const waitForHandler = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    vi.mocked(runJobHandler).mockImplementationOnce(async () => {
      announceStarted();
      await waitForHandler;
      return undefined;
    });

    const job = await firstClient.job.findUniqueOrThrow({ where: { id: created.id } });
    const stats: ProcessResult = {
      claimed: 1,
      succeeded: 0,
      failed: 0,
      retried: 0,
      rescheduled: 0,
    };
    const execution = executeJob(job, stats);
    try {
      await handlerStarted;
      // Exercise the real periodic timer against PostgreSQL instead of only
      // advancing fake timers around the database driver's own async work.
      await new Promise((resolve) => setTimeout(resolve, JOB_LEASE_RENEW_INTERVAL_MS + 1_000));
      const heartbeated = await secondClient.job.findUniqueOrThrow({ where: { id: created.id } });
      expect(heartbeated.lockedAt?.getTime()).toBeGreaterThan(originalLock.getTime());

      await recoverStaleLocks();
      const stillOwned = await secondClient.job.findUniqueOrThrow({ where: { id: created.id } });
      expect(stillOwned.status).toBe('RUNNING');
      expect(stillOwned.claimToken).toBe('heartbeat-claim-token');
    } finally {
      releaseHandler();
      await execution;
    }

    const completed = await secondClient.job.findUniqueOrThrow({ where: { id: created.id } });
    expect(completed.status).toBe('DONE');
    expect(stats.succeeded).toBe(1);
  }, 90_000);
});
