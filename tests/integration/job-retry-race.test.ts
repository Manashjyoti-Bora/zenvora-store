import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import { unique } from './fixtures';

vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn(async () => ({ id: 'ci-admin', email: 'admin@ci.local' })),
}));
vi.mock('@/lib/jobs/queue', () => ({
  kickJobRunner: vi.fn(),
}));
vi.mock('@/lib/audit', () => ({
  auditLog: vi.fn(),
}));

import { POST } from '@/app/api/admin/jobs/[id]/retry/route';

describe('admin job retry race (PostgreSQL)', () => {
  const secondConnection = new PrismaClient();
  let jobId: string | null = null;

  afterEach(async () => {
    if (jobId) await prisma.job.deleteMany({ where: { id: jobId } });
    jobId = null;
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await secondConnection.$disconnect();
  });

  it('does not reset a job claimed after the admin read but before the conditional update', async () => {
    await secondConnection.$connect();
    const job = await prisma.job.create({
      data: {
        type: 'SEND_NOTIFICATION',
        payload: { notificationId: 'retry-race-test' },
        dedupeKey: `itest:${unique('retry-race')}`,
        status: 'FAILED',
        lastError: 'previous attempt failed',
      },
    });
    jobId = job.id;

    const originalFindUnique = prisma.job.findUnique.bind(prisma.job);
    let signalFound!: () => void;
    let releaseRoute!: () => void;
    const rowRead = new Promise<void>((resolve) => {
      signalFound = resolve;
    });
    const waitForClaim = new Promise<void>((resolve) => {
      releaseRoute = resolve;
    });
    const findSpy = vi.spyOn(prisma.job, 'findUnique').mockImplementation(
      (args) =>
        originalFindUnique(args).then(async (result) => {
          if (args.where.id === job.id) {
            signalFound();
            await waitForClaim;
          }
          return result;
        }) as never
    );

    const responsePromise = POST(new Request('http://localhost/api/admin/jobs/test/retry'), {
      params: Promise.resolve({ id: job.id }),
    });
    try {
      await rowRead;
      const claimed = await secondConnection.job.updateMany({
        where: { id: job.id, status: 'FAILED' },
        data: { status: 'RUNNING', claimToken: 'claimed-during-admin-retry', lockedAt: new Date() },
      });
      expect(claimed.count).toBe(1);
      releaseRoute();

      const response = await responsePromise;
      expect(response.status).toBe(409);
      const persisted = await secondConnection.job.findUniqueOrThrow({ where: { id: job.id } });
      expect(persisted.status).toBe('RUNNING');
      expect(persisted.claimToken).toBe('claimed-during-admin-retry');
      expect(persisted.lastError).toBe('previous attempt failed');
    } finally {
      releaseRoute();
      await responsePromise;
      findSpy.mockRestore();
    }
  }, 30_000);
});
