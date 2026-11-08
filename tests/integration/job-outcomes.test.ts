import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { enqueueJob } from '@/lib/jobs/queue';
import { processDueJobs, type ProcessResult } from '@/lib/jobs/runner';
import { cleanupTestData, testEmail, unique } from './fixtures';

const originalEmail = {
  provider: env.EMAIL_PROVIDER,
  host: env.SMTP_HOST,
  user: env.SMTP_USER,
  pass: env.SMTP_PASS,
};

function useConsoleProvider() {
  env.EMAIL_PROVIDER = 'console';
  env.SMTP_HOST = undefined;
  env.SMTP_USER = undefined;
  env.SMTP_PASS = undefined;
}

async function drainDueJobs(): Promise<ProcessResult> {
  let last: ProcessResult = {
    claimed: 0,
    succeeded: 0,
    failed: 0,
    retried: 0,
    rescheduled: 0,
  };
  for (let pass = 0; pass < 20; pass += 1) {
    last = await processDueJobs({ limit: 100 });
    if (last.claimed === 0 && last.failed === 0) return last;
  }
  throw new Error(`Isolated queue did not become idle: ${JSON.stringify(last)}`);
}

async function queuedNotification() {
  return prisma.notification.create({
    data: {
      template: 'WELCOME',
      email: testEmail('job-outcome'),
      subject: 'Isolated queue outcome test',
      bodyHtml: '<p>Isolated test only; not a customer message.</p>',
      bodyText: 'Isolated test only; not a customer message.',
      status: 'QUEUED',
    },
  });
}

describe('durable worker outcomes (isolated queue; no real email)', () => {
  beforeAll(async () => {
    useConsoleProvider();
    await cleanupTestData();
    await drainDueJobs();
  }, 120_000);

  afterAll(async () => {
    useConsoleProvider();
    await cleanupTestData();
    env.EMAIL_PROVIDER = originalEmail.provider;
    env.SMTP_HOST = originalEmail.host;
    env.SMTP_USER = originalEmail.user;
    env.SMTP_PASS = originalEmail.pass;
  });

  it('reports a real no-op when no due job is claimed', async () => {
    const stats = await processDueJobs({ limit: 100 });
    expect(stats).toEqual({ claimed: 0, succeeded: 0, failed: 0, retried: 0, rescheduled: 0 });
  });

  it('marks a console handoff and its durable job DONE/SENT, not inbox delivery', async () => {
    const notification = await queuedNotification();
    const jobId = await enqueueJob({
      type: 'SEND_NOTIFICATION',
      payload: { notificationId: notification.id },
      dedupeKey: `itest:${unique('console-handoff')}`,
    });
    const stats = await processDueJobs({ limit: 100 });
    expect(stats.claimed).toBeGreaterThanOrEqual(1);

    const [job, delivered] = await Promise.all([
      prisma.job.findUniqueOrThrow({ where: { id: jobId! } }),
      prisma.notification.findUniqueOrThrow({ where: { id: notification.id } }),
    ]);
    expect(job.status).toBe('DONE');
    expect(job.completedAt).not.toBeNull();
    expect(delivered.status).toBe('SENT');
    expect(delivered.provider).toBe('console');
    expect(delivered.sentAt).not.toBeNull();
  });

  it('missing SMTP records FAILED on BOTH notification and terminal job (never DONE)', async () => {
    const notification = await queuedNotification();
    const jobId = await enqueueJob({
      type: 'SEND_NOTIFICATION',
      payload: { notificationId: notification.id },
      dedupeKey: `itest:${unique('smtp-missing')}`,
      maxAttempts: 1,
    });

    env.EMAIL_PROVIDER = 'smtp';
    env.SMTP_HOST = undefined;
    env.SMTP_USER = undefined;
    env.SMTP_PASS = undefined;
    let stats: ProcessResult;
    try {
      stats = await processDueJobs({ limit: 100 });
    } finally {
      useConsoleProvider();
    }

    expect(stats.failed).toBeGreaterThanOrEqual(1);
    const [job, failed] = await Promise.all([
      prisma.job.findUniqueOrThrow({ where: { id: jobId! } }),
      prisma.notification.findUniqueOrThrow({ where: { id: notification.id } }),
    ]);
    expect(job.status).toBe('FAILED');
    expect(job.status).not.toBe('DONE');
    expect(job.attempts).toBe(1);
    expect(job.lastError).toMatch(/SMTP is not fully configured/i);
    expect(failed.status).toBe('FAILED');
    expect(failed.provider).toBe('smtp');
    expect(failed.error).toMatch(/SMTP_HOST\/SMTP_USER\/SMTP_PASS/);
    expect(failed.sentAt).toBeNull();
  });
});
