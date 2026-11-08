import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    job: { findMany: vi.fn(), updateMany: vi.fn() },
    supplierOrder: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/jobs/handlers', () => ({ runJobHandler: vi.fn() }));

import { prisma } from '@/lib/db';
import { runJobHandler } from '@/lib/jobs/handlers';
import {
  claimJobs,
  executeJob,
  JOB_LEASE_RENEW_INTERVAL_MS,
  recoverStaleLocks,
  type ProcessResult,
} from '@/lib/jobs/runner';

const newStats = (): ProcessResult => ({
  claimed: 0,
  succeeded: 0,
  failed: 0,
  retried: 0,
  rescheduled: 0,
});

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    type: 'SEND_NOTIFICATION',
    payload: { notificationId: 'notification-1' },
    status: 'RUNNING',
    attempts: 0,
    maxAttempts: 4,
    nextRunAt: new Date(),
    lockedAt: new Date(),
    claimToken: 'claim-old',
    lastError: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as never;
}

describe('job worker fencing (mocked Prisma; not PostgreSQL concurrency evidence)', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.mocked(prisma.job.findMany).mockReset();
    vi.mocked(prisma.job.updateMany).mockReset();
    vi.mocked(prisma.supplierOrder.updateMany).mockReset();
    vi.mocked(prisma.$transaction).mockReset();
    vi.mocked(runJobHandler).mockReset();
  });

  it('discards a successful old-worker completion after ownership changes', async () => {
    vi.mocked(runJobHandler).mockResolvedValue(undefined);
    vi.mocked(prisma.job.updateMany).mockResolvedValue({ count: 0 } as never);
    const stats = newStats();

    await executeJob(job(), stats);

    expect(prisma.job.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1', status: 'RUNNING', claimToken: 'claim-old' },
        data: expect.objectContaining({ status: 'DONE', claimToken: null, lockedAt: null }),
      })
    );
    expect(stats.succeeded).toBe(0);
  });

  it('discards an old-worker failure and does not schedule its retry', async () => {
    vi.mocked(runJobHandler).mockRejectedValue(new Error('late worker error'));
    vi.mocked(prisma.job.updateMany).mockResolvedValue({ count: 0 } as never);
    const stats = newStats();

    await executeJob(job(), stats);

    expect(prisma.job.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1', status: 'RUNNING', claimToken: 'claim-old' },
        data: expect.objectContaining({ status: 'PENDING', attempts: 1, claimToken: null }),
      })
    );
    expect(stats.retried).toBe(0);
    expect(stats.failed).toBe(0);
  });

  it('renews the lease while a handler remains active', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    vi.mocked(runJobHandler).mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve))
    );
    vi.mocked(prisma.job.updateMany).mockResolvedValue({ count: 1 } as never);
    const stats = newStats();
    const execution = executeJob(job(), stats);

    await vi.advanceTimersByTimeAsync(JOB_LEASE_RENEW_INTERVAL_MS);
    expect(prisma.job.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1', status: 'RUNNING', claimToken: 'claim-old' },
        data: { lockedAt: expect.any(Date) },
      })
    );
    finish();
    await execution;
    expect(stats.succeeded).toBe(1);
  });

  it('does not write completion after renewal proves the lease was lost', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    vi.mocked(runJobHandler).mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve))
    );
    vi.mocked(prisma.job.updateMany).mockResolvedValue({ count: 0 } as never);
    const stats = newStats();
    const execution = executeJob(job(), stats);

    await vi.advanceTimersByTimeAsync(JOB_LEASE_RENEW_INTERVAL_MS);
    finish();
    await execution;

    expect(prisma.job.updateMany).toHaveBeenCalledTimes(1);
    expect(stats.succeeded).toBe(0);
  });

  it('recovers an expired lease with a new attempt and clears old ownership', async () => {
    vi.mocked(prisma.job.findMany).mockResolvedValue([
      job({ lockedAt: new Date(Date.now() - 11 * 60_000), attempts: 1 }),
    ] as never);
    vi.mocked(prisma.job.updateMany).mockResolvedValue({ count: 1 } as never);

    await expect(recoverStaleLocks()).resolves.toMatchObject({ recovered: 1, failed: 0 });
    expect(prisma.job.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'job-1',
          status: 'RUNNING',
          claimToken: 'claim-old',
          OR: expect.arrayContaining([{ lockedAt: null }, { lockedAt: { lt: expect.any(Date) } }]),
        }),
        data: expect.objectContaining({
          status: 'PENDING',
          attempts: 2,
          claimToken: null,
          lockedAt: null,
          lastError: expect.stringContaining('lease expired'),
        }),
      })
    );
  });

  it('does not automatically retry a cancellation job after an expired worker lease', async () => {
    vi.mocked(prisma.job.findMany).mockResolvedValue([
      job({
        type: 'CANCEL_SUPPLIER_ORDER',
        payload: { supplierOrderId: 'supplier-order-1', reason: 'customer request' },
        lockedAt: new Date(Date.now() - 11 * 60_000),
      }),
    ] as never);
    vi.mocked(prisma.job.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.supplierOrder.updateMany).mockResolvedValue({ count: 1 } as never);

    await expect(recoverStaleLocks()).resolves.toEqual({ recovered: 1, failed: 1 });
    expect(prisma.job.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', claimToken: null }),
      })
    );
    expect(prisma.supplierOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'supplier-order-1',
          cancellationStatus: { in: ['NONE', 'REQUESTED', 'SUBMITTING', 'REJECTED'] },
        },
        data: expect.objectContaining({
          cancellationStatus: 'MANUAL_ACTION_REQUIRED',
          cancellationMessage: expect.stringContaining('Verify directly with the supplier'),
        }),
      })
    );
  });

  it('recovers legacy RUNNING rows with no lock timestamp', async () => {
    vi.mocked(prisma.job.findMany).mockResolvedValue([
      job({ lockedAt: null, claimToken: null }),
    ] as never);
    vi.mocked(prisma.job.updateMany).mockResolvedValue({ count: 1 } as never);

    await expect(recoverStaleLocks()).resolves.toEqual({ recovered: 1, failed: 0 });
    expect(prisma.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'RUNNING',
          OR: [{ lockedAt: null }, { lockedAt: { lt: expect.any(Date) } }],
        },
      })
    );
    expect(prisma.job.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          claimToken: null,
          OR: [{ lockedAt: null }, { lockedAt: { lt: expect.any(Date) } }],
        }),
        data: expect.objectContaining({ status: 'PENDING', claimToken: null }),
      })
    );
  });

  it('does not reclaim a lease that was renewed after the stale scan', async () => {
    vi.mocked(prisma.job.findMany).mockResolvedValue([
      job({ lockedAt: new Date(Date.now() - 11 * 60_000) }),
    ] as never);
    vi.mocked(prisma.job.updateMany).mockResolvedValue({ count: 0 } as never);

    await expect(recoverStaleLocks()).resolves.toEqual({ recovered: 0, failed: 0 });
  });

  it('claims rows with SKIP LOCKED and assigns distinct per-job fencing tokens', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'job-1' }, { id: 'job-2' }]),
      job: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([job(), job({ id: 'job-2', claimToken: 'claim-2' })]),
      },
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      (callback as unknown as (transaction: typeof tx) => Promise<unknown>)(tx)
    );

    await claimJobs(2);

    const sql = tx.$queryRaw.mock.calls[0]?.[0]?.join(' ') ?? '';
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    const updates = tx.job.updateMany.mock.calls.map(([args]) => args);
    const tokens = updates.map((args) => args.data.claimToken);
    expect(new Set(tokens).size).toBe(2);
    expect(updates.every((args) => args.where.status === 'PENDING')).toBe(true);
  });

  it('only one concurrent completion can clear the claim token', async () => {
    vi.mocked(runJobHandler).mockResolvedValue(undefined);
    vi.mocked(prisma.job.updateMany)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 0 } as never);
    const first = newStats();
    const second = newStats();

    await Promise.all([executeJob(job(), first), executeJob(job(), second)]);

    expect(first.succeeded + second.succeeded).toBe(1);
  });

  it('does not turn a result-write error into a handler retry', async () => {
    vi.mocked(runJobHandler).mockResolvedValue(undefined);
    vi.mocked(prisma.job.updateMany).mockRejectedValue(new Error('database write failed'));
    const stats = newStats();

    await expect(executeJob(job(), stats)).rejects.toThrow('database write failed');

    expect(prisma.job.updateMany).toHaveBeenCalledTimes(1);
    expect(stats.retried).toBe(0);
    expect(stats.failed).toBe(0);
  });

  it('reschedules a legitimate transient failure within the attempt budget', async () => {
    vi.mocked(runJobHandler).mockRejectedValue(new Error('temporary provider outage'));
    vi.mocked(prisma.job.updateMany).mockResolvedValue({ count: 1 } as never);
    const stats = newStats();

    await executeJob(job({ attempts: 0, maxAttempts: 4 }), stats);

    expect(prisma.job.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1', status: 'RUNNING', claimToken: 'claim-old' },
        data: expect.objectContaining({
          status: 'PENDING',
          attempts: 1,
          nextRunAt: expect.any(Date),
          claimToken: null,
        }),
      })
    );
    expect(stats.retried).toBe(1);
  });
});
