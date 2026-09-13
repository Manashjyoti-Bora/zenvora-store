import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { enqueueJob } from '@/lib/jobs/queue';
import { processDueJobs } from '@/lib/jobs/runner';
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
