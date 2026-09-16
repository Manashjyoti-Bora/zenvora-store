import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { sha256 } from '@/lib/crypto';
import { processDueJobs } from '@/lib/jobs/runner';
import { queueNotification } from '@/lib/notifications/notify';
import { cleanupTestData } from './fixtures';

/**
 * Regression tests for the production incident (2026-09-13, v13):
 * a PASSWORD_RESET request logged "Notification de-duplicated" and no email
 * was ever delivered, because queueNotification treated ANY existing job row
 * with the same dedupeKey as a duplicate — including stranded PENDING jobs
 * left behind by the pre-v13 fire-and-forget bug and FAILED/CANCELLED jobs —
 * and returned early WITHOUT kicking the runner. The whole 10-minute window
 * became a dead end and recovery (password reset) was blocked.
 *
 * Contract enforced here:
 *  1. a stale QUEUED notification with a stranded PENDING job must still be
 *     delivered when a new request hits the same window (skip creating a
 *     duplicate, but kick the runner);
 *  2. a FAILED previous attempt must allow a legitimate retry with fresh
 *     content (new notification row, job row requeued and delivered);
 *  3. a genuinely SENT email inside the window must still be de-duplicated
 *     (no second email, job NOT requeued) — dedupe stays enabled.
 */

const BUCKET_MS = 600_000; // 10-minute window, identical to notify.ts

function buildKey(email: string, extra: string): { dedupeKey: string; bucket: number } {
  const bucket = Math.floor(Date.now() / BUCKET_MS);
  const dedupeKey = ['ntf', 'PASSWORD_RESET', '-', sha256(email).slice(0, 10), bucket, extra].join(
    ':'
  );
  return { dedupeKey, bucket };
}

/** Fail loudly instead of mysteriously if a test straddles a bucket boundary. */
function assertSameBucket(before: number): void {
  const now = Math.floor(Date.now() / BUCKET_MS);
  if (now !== before) {
    throw new Error(`test crossed a 10-minute dedupe boundary (${before} -> ${now}); re-run`);
  }
}

async function deliverAll(): Promise<void> {
  for (let i = 0; i < 25; i++) {
    await processDueJobs({ limit: 25 });
    const pending = await prisma.job.count({ where: { status: 'PENDING' } });
    if (pending === 0) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('notification dedupe recovery (password-reset window semantics)', () => {
  beforeAll(async () => {
    await cleanupTestData();
  });
  afterAll(async () => {
    await cleanupTestData();
    // cleanupTestData only removes 'itest:'-prefixed job keys; these tests use
    // production-shaped 'ntf:…' keys with an itest- suffix — remove them too
    // (notification rows are covered by the @itest.local email cleanup).
    await prisma.job.deleteMany({ where: { dedupeKey: { contains: ':itest-' } } });
  });

  it('stale QUEUED notification + stranded PENDING job: new request does not duplicate but the stranded email IS delivered', async () => {
    const email = `reset-stranded-${Date.now()}@itest.local`;
    const { dedupeKey, bucket } = buildKey(email, 'itest-stranded');

    // Simulate the exact pre-v13 production leftover: notification stuck
    // QUEUED, job stuck PENDING, nothing ever processed them.
    const stranded = await prisma.notification.create({
      data: {
        template: 'PASSWORD_RESET',
        channel: 'EMAIL',
        email,
        subject: 'Reset your Zenvora password',
        bodyText: 'Reset link (older request, token still valid within TTL)',
        status: 'QUEUED',
      },
    });
    await prisma.job.create({
      data: {
        type: 'SEND_NOTIFICATION',
        payload: { notificationId: stranded.id },
        dedupeKey,
        status: 'PENDING',
        nextRunAt: new Date(Date.now() - 60_000), // due since a minute
      },
    });

    // New password-reset request lands inside the same 10-minute window.
    const result = await queueNotification({
      template: 'PASSWORD_RESET',
      email,
      vars: { name: 'Owner', resetUrl: 'https://example.test/auth/reset-password?token=test-only' },
      dedupeExtra: 'itest-stranded',
    });
    assertSameBucket(bucket);

    expect(result).toBeNull(); // no second email created (dedupe preserved)
    expect(await prisma.notification.count({ where: { email } })).toBe(1);

    // The kick (or this explicit pass) must deliver the stranded notification:
    // recovery is NEVER blocked by the stale row.
    await deliverAll();
    const delivered = await prisma.notification.findUniqueOrThrow({ where: { id: stranded.id } });
    expect(delivered.status).toBe('SENT');
    expect(delivered.sentAt).not.toBeNull();
  }, 30_000);

  it('FAILED previous attempt: a legitimate retry creates a fresh notification and requeues the job', async () => {
    const email = `reset-failed-${Date.now()}@itest.local`;
    const { dedupeKey, bucket } = buildKey(email, 'itest-failed');

    const failed = await prisma.notification.create({
      data: {
        template: 'PASSWORD_RESET',
        channel: 'EMAIL',
        email,
        subject: 'Reset your Zenvora password',
        bodyText: 'previous attempt',
        status: 'FAILED',
        error: 'SMTP transport error (simulated)',
      },
    });
    await prisma.job.create({
      data: {
        type: 'SEND_NOTIFICATION',
        payload: { notificationId: failed.id },
        dedupeKey,
        status: 'FAILED',
        attempts: 6,
        maxAttempts: 6,
        lastError: 'SMTP transport error (simulated)',
        completedAt: new Date(),
      },
    });

    const retryId = await queueNotification({
      template: 'PASSWORD_RESET',
      email,
      vars: { name: 'Owner', resetUrl: 'https://example.test/auth/reset-password?token=test-only-2' },
      dedupeExtra: 'itest-failed',
    });
    assertSameBucket(bucket);

    expect(retryId).not.toBeNull(); // retry allowed — window is not a dead end
    expect(retryId).not.toBe(failed.id);

    // The SAME job row is requeued (one row per dedupe key) with the fresh payload.
    const job = await prisma.job.findUniqueOrThrow({ where: { dedupeKey } });
    expect(job.status).toBe('PENDING');
    expect(job.attempts).toBe(0);
    expect(job.lastError).toBeNull();
    expect((job.payload as { notificationId?: string }).notificationId).toBe(retryId);

    await deliverAll();
    const retry = await prisma.notification.findUniqueOrThrow({ where: { id: retryId! } });
    expect(retry.status).toBe('SENT');
    const old = await prisma.notification.findUniqueOrThrow({ where: { id: failed.id } });
    expect(old.status).toBe('FAILED'); // history preserved, never rewritten
  }, 30_000);

  it('already SENT inside the window: true dedupe — no second email and the job is NOT requeued', async () => {
    const email = `reset-sent-${Date.now()}@itest.local`;
    const { dedupeKey, bucket } = buildKey(email, 'itest-sent');

    const sent = await prisma.notification.create({
      data: {
        template: 'PASSWORD_RESET',
        channel: 'EMAIL',
        email,
        subject: 'Reset your Zenvora password',
        bodyText: 'delivered email',
        status: 'SENT',
        provider: 'console',
        sentAt: new Date(),
      },
    });
    await prisma.job.create({
      data: {
        type: 'SEND_NOTIFICATION',
        payload: { notificationId: sent.id },
        dedupeKey,
        status: 'DONE',
        attempts: 1,
        completedAt: new Date(),
      },
    });

    const duplicate = await queueNotification({
      template: 'PASSWORD_RESET',
      email,
      vars: { name: 'Owner', resetUrl: 'https://example.test/auth/reset-password?token=test-only-3' },
      dedupeExtra: 'itest-sent',
    });
    assertSameBucket(bucket);

    expect(duplicate).toBeNull(); // spam protection intact
    expect(await prisma.notification.count({ where: { email } })).toBe(1);
    const job = await prisma.job.findUniqueOrThrow({ where: { dedupeKey } });
    expect(job.status).toBe('DONE'); // untouched — NOT requeued
    expect((job.payload as { notificationId?: string }).notificationId).toBe(sent.id);
  }, 30_000);

  it('DONE job but orphaned/missing notification row: treated as not delivered and retried', async () => {
    const email = `reset-orphan-${Date.now()}@itest.local`;
    const { dedupeKey, bucket } = buildKey(email, 'itest-orphan');

    await prisma.job.create({
      data: {
        type: 'SEND_NOTIFICATION',
        payload: { notificationId: 'missing-notification-id-orphan-test' },
        dedupeKey,
        status: 'DONE',
        attempts: 1,
        completedAt: new Date(),
      },
    });

    const retried = await queueNotification({
      template: 'PASSWORD_RESET',
      email,
      vars: { name: 'Owner', resetUrl: 'https://example.test/auth/reset-password?token=test-only-4' },
      dedupeExtra: 'itest-orphan',
    });
    assertSameBucket(bucket);

    expect(retried).not.toBeNull(); // no SENT email exists -> recovery allowed
    await deliverAll();
    const delivered = await prisma.notification.findUniqueOrThrow({ where: { id: retried! } });
    expect(delivered.status).toBe('SENT');
  }, 30_000);
});
