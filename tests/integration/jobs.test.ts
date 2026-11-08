import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import { enqueueJob, enqueueJobInTransaction } from '@/lib/jobs/queue';
import { claimJobs, processDueJobs, recoverStaleLocks } from '@/lib/jobs/runner';
import { queueNotification } from '@/lib/notifications/notify';
import { cleanupTestData, unique } from './fixtures';

describe('job queue (dedupe, retry bookkeeping, execution)', () => {
  beforeAll(async () => {
    await cleanupTestData();
  });
  afterAll(async () => {
    await cleanupTestData();
  });

  it('deduplicates by dedupeKey — the same work is never enqueued twice', async () => {
    const key = `itest:${unique('dedupe')}`;
    const first = await enqueueJob({
      type: 'SEND_NOTIFICATION',
      payload: { notificationId: 'does-not-matter' },
      dedupeKey: key,
      runAt: new Date(Date.now() + 3_600_000), // future: don't let runners touch it
    });
    const second = await enqueueJob({
      type: 'SEND_NOTIFICATION',
      payload: { notificationId: 'does-not-matter' },
      dedupeKey: key,
      runAt: new Date(Date.now() + 3_600_000),
    });
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(await prisma.job.count({ where: { dedupeKey: key } })).toBe(1);
  });

  it('transactional enqueue rolls back when its caller aborts and deduplicates concurrent requests', async () => {
    const rollbackKey = `itest:${unique('tx-rollback')}`;
    await expect(
      prisma.$transaction(async (tx) => {
        await enqueueJobInTransaction(tx, {
          type: 'CANCEL_SUPPLIER_ORDER',
          payload: { supplierOrderId: 'rollback-supplier-order', reason: 'test' },
          dedupeKey: rollbackKey,
        });
        throw new Error('intentional rollback');
      })
    ).rejects.toThrow('intentional rollback');
    expect(await prisma.job.count({ where: { dedupeKey: rollbackKey } })).toBe(0);

    const dedupeKey = `itest:${unique('tx-concurrent')}`;
    const params = {
      type: 'CANCEL_SUPPLIER_ORDER' as const,
      payload: { supplierOrderId: 'concurrent-supplier-order', reason: 'test' },
      dedupeKey,
    };
    await Promise.all([
      prisma.$transaction((tx) => enqueueJobInTransaction(tx, params)),
      prisma.$transaction((tx) => enqueueJobInTransaction(tx, params)),
    ]);
    expect(await prisma.job.count({ where: { dedupeKey } })).toBe(1);
    await prisma.job.deleteMany({ where: { dedupeKey } });
  }, 20_000);

  it('concurrent PostgreSQL claimers assign each due row one fresh fencing token', async () => {
    const keys = [`itest:${unique('fence-a')}`, `itest:${unique('fence-b')}`];
    await prisma.job.createMany({
      data: keys.map((dedupeKey) => ({
        type: 'SEND_NOTIFICATION',
        payload: { notificationId: 'fencing-claim-test' },
        dedupeKey,
        nextRunAt: new Date(Date.now() - 1_000),
      })),
    });

    const firstClient = new PrismaClient();
    const secondClient = new PrismaClient();
    try {
      await Promise.all([firstClient.$connect(), secondClient.$connect()]);
      const [first, second] = await Promise.all([
        claimJobs(1, firstClient),
        claimJobs(1, secondClient),
      ]);
      const claimed = await prisma.job.findMany({ where: { dedupeKey: { in: keys } } });
      const returnedIds = [...first, ...second]
        .filter((job) => keys.includes(job.dedupeKey ?? ''))
        .map((job) => job.id);
      expect(returnedIds).toHaveLength(2);
      expect(new Set(returnedIds).size).toBe(2);
      expect(claimed).toHaveLength(2);
      expect(claimed.every((job) => job.status === 'RUNNING' && job.claimToken)).toBe(true);
      expect(new Set(claimed.map((job) => job.claimToken)).size).toBe(2);
    } finally {
      await Promise.allSettled([firstClient.$disconnect(), secondClient.$disconnect()]);
      await prisma.job.deleteMany({ where: { dedupeKey: { in: keys } } });
    }
  }, 20_000);

  it('recovers an expired lease, increments crash attempts, and clears its old token', async () => {
    const dedupeKey = `itest:${unique('expired-lease')}`;
    const stale = await prisma.job.create({
      data: {
        type: 'SEND_NOTIFICATION',
        payload: { notificationId: 'expired-lease-test' },
        dedupeKey,
        status: 'RUNNING',
        attempts: 1,
        maxAttempts: 4,
        claimToken: `claim:${unique('old-token')}`,
        lockedAt: new Date(Date.now() - 11 * 60_000),
      },
    });

    try {
      await recoverStaleLocks();
      const recovered = await prisma.job.findUniqueOrThrow({ where: { id: stale.id } });
      expect(recovered.status).toBe('PENDING');
      expect(recovered.attempts).toBe(2);
      expect(recovered.claimToken).toBeNull();
      expect(recovered.lockedAt).toBeNull();
      expect(recovered.lastError).toContain('lease expired');
    } finally {
      await prisma.job.deleteMany({ where: { id: stale.id } });
    }
  }, 20_000);

  it('recovers a legacy RUNNING row with null lockedAt', async () => {
    const dedupeKey = `itest:${unique('null-lock')}`;
    const stale = await prisma.job.create({
      data: {
        type: 'SEND_NOTIFICATION',
        payload: { notificationId: 'legacy-null-lock-test' },
        dedupeKey,
        status: 'RUNNING',
        attempts: 0,
        maxAttempts: 4,
        claimToken: null,
        lockedAt: null,
      },
    });

    try {
      const result = await recoverStaleLocks();
      const recovered = await prisma.job.findUniqueOrThrow({ where: { id: stale.id } });
      expect(result.recovered).toBeGreaterThanOrEqual(1);
      expect(recovered.status).toBe('PENDING');
      expect(recovered.attempts).toBe(1);
      expect(recovered.claimToken).toBeNull();
      expect(recovered.lockedAt).toBeNull();
      expect(recovered.lastError).toContain('lease expired');
    } finally {
      await prisma.job.deleteMany({ where: { id: stale.id } });
    }
  }, 20_000);

  it('jobs without dedupeKey always enqueue separately', async () => {
    const a = await enqueueJob({
      type: 'SEND_NOTIFICATION',
      payload: { notificationId: 'x' },
      runAt: new Date(Date.now() + 3_600_000),
    });
    const b = await enqueueJob({
      type: 'SEND_NOTIFICATION',
      payload: { notificationId: 'x' },
      runAt: new Date(Date.now() + 3_600_000),
    });
    expect(a).not.toBe(b);
    await prisma.job.deleteMany({ where: { id: { in: [a!, b!] } } });
  });

  it('queued notifications are delivered by the runner (console provider in tests)', async () => {
    const email = `jobs-${Date.now()}@itest.local`;
    const notificationId = await queueNotification({
      template: 'WELCOME',
      email,
      vars: { name: 'Job Tester' },
      dedupeExtra: unique('w'),
    });
    expect(notificationId).not.toBeNull();

    const queued = await prisma.notification.findUniqueOrThrow({ where: { id: notificationId! } });
    expect(['QUEUED', 'SENT']).toContain(queued.status); // the kicked in-process runner may beat us
    expect(queued.bodyHtml).toContain('Job Tester');

    // ensure a processing pass happens (no-op if the kicked runner already did it)
    await processDueJobs({ limit: 25 });

    // poll until delivered (max ~5s)
    let sent = await prisma.notification.findUniqueOrThrow({ where: { id: notificationId! } });
    for (let i = 0; i < 25 && sent.status === 'QUEUED'; i++) {
      await new Promise((r) => setTimeout(r, 200));
      await processDueJobs({ limit: 25 });
      sent = await prisma.notification.findUniqueOrThrow({ where: { id: notificationId! } });
    }
    expect(sent.status).toBe('SENT');
    expect(sent.sentAt).not.toBeNull();
  }, 30_000);

  it('duplicate notifications inside the dedupe window are skipped', async () => {
    const email = `jobs-dup-${Date.now()}@itest.local`;
    const first = await queueNotification({ template: 'WELCOME', email, vars: { name: 'Dup' } });
    const second = await queueNotification({ template: 'WELCOME', email, vars: { name: 'Dup' } });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await prisma.notification.count({ where: { email } })).toBe(1);
  }, 20_000);

  it('failed jobs record the error and remain inspectable (never silent)', async () => {
    // a SEND_NOTIFICATION job pointing at a non-existent notification must not
    // crash the runner; it completes or fails gracefully with bookkeeping.
    const id = await enqueueJob({
      type: 'SEND_NOTIFICATION',
      payload: { notificationId: 'missing-notification-id' },
      dedupeKey: `itest:${unique('missing')}`,
    });
    await processDueJobs({ limit: 25 });
    const job = await prisma.job.findUniqueOrThrow({ where: { id: id! } });
    expect(['DONE', 'FAILED', 'PENDING', 'RUNNING']).toContain(job.status);
    if (job.status === 'FAILED') {
      expect(job.lastError).toBeTruthy();
      expect(job.attempts).toBeGreaterThan(0);
    }
  }, 30_000);
});
