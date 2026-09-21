import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { sha256 } from '@/lib/crypto';
import { hashPassword } from '@/lib/auth/password';
import { requestPasswordReset, resetPassword, loginUser } from '@/lib/auth/service';
import { queueNotification } from '@/lib/notifications/notify';
import { cleanupTestData, testEmail } from './fixtures';

/**
 * Regression tests for the password-reset dedupe collision (production issue:
 * "invalid or expired" reset links).
 *
 * Before the fix, requestPasswordReset() queued PASSWORD_RESET notifications
 * WITHOUT a per-token discriminator, so two requests for the same email inside
 * one 10-minute bucket produced ONE notification: the newest token was stored
 * in the DB but never emailed, while the delivered/older link could already be
 * used or expired. The fix adds `dedupeExtra: sha256(token)` — a one-way
 * discriminator (the raw token never appears in the dedupe key).
 *
 * Contract proven here:
 *  1. two same-window requests → two notifications with DIFFERENT tokens and
 *     two jobs with DIFFERENT dedupe identities;
 *  2. each notification carries the reset URL whose token matches a real,
 *     unused PasswordResetToken row for that user;
 *  3. the newest token validates and resets the password end-to-end (and is
 *     single-use: replay fails with the generic error);
 *  4. window dedupe for OTHER templates (no dedupeExtra) is unchanged.
 *
 * Test-only credentials below are ephemeral fixtures in the local test DB —
 * never production secrets. Raw tokens are never printed.
 */

const BUCKET_MS = 600_000; // must match notify.ts 10-minute window
const bucketOf = (): number => Math.floor(Date.now() / BUCKET_MS);

function extractToken(body: string | null): string {
  const m = /token=([A-Za-z0-9]+)/.exec(body ?? '');
  if (!m) throw new Error('no reset token found in notification body');
  return m[1];
}

describe('password-reset token dedupe identity (per-token emails)', () => {
  let email: string;
  let userId: string;
  const INITIAL_PASSWORD = 'InitialTest#1pass'; // ephemeral test fixture, not a secret

  beforeAll(async () => {
    await cleanupTestData();
    email = testEmail('pwdreset');
    const user = await prisma.user.create({
      data: {
        email,
        name: 'Reset Tester',
        passwordHash: await hashPassword(INITIAL_PASSWORD),
        role: 'CUSTOMER',
        status: 'ACTIVE',
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    // Remove this file's 'ntf:'-prefixed job rows (cleanupTestData only
    // handles 'itest:'-prefixed keys) via their notification payload links.
    const ntfs = await prisma.notification.findMany({
      where: { email: { endsWith: '@itest.local' } },
      select: { id: true },
    });
    if (ntfs.length > 0) {
      await prisma.job.deleteMany({
        where: {
          type: 'SEND_NOTIFICATION',
          OR: ntfs.map((n) => ({ payload: { path: ['notificationId'], equals: n.id } })),
        },
      });
    }
    await cleanupTestData();
  });

  it('1+2: two same-window requests produce two notifications with different tokens, distinct dedupe identities, and each emailed token exists unused in the DB', async () => {
    const startBucket = bucketOf();

    await requestPasswordReset({ email });
    await requestPasswordReset({ email });

    if (bucketOf() !== startBucket) {
      throw new Error('test crossed a 10-minute dedupe boundary; re-run');
    }

    const notifications = await prisma.notification.findMany({
      where: { email, template: 'PASSWORD_RESET' },
      orderBy: { createdAt: 'asc' },
    });
    // Before the fix this was 1 (second request de-duplicated); now each
    // request gets its own email.
    expect(notifications).toHaveLength(2);

    const tokens = notifications.map((n) => extractToken(n.bodyText));
    expect(tokens[0]).not.toBe(tokens[1]); // distinct tokens per request

    for (const n of notifications) {
      // (2) the notification carries the actual reset URL …
      expect(n.bodyText).toContain('/auth/reset-password?token=');
      // The kicked in-process runner may beat this assertion (same idiom as
      // jobs.test.ts): QUEUED before delivery, SENT after — both are correct;
      // FAILED would indicate a real problem.
      expect(['QUEUED', 'SENT']).toContain(n.status);
    }

    // … and each emailed token corresponds to a real, unused token row for
    // this user (the sha256 link proves DB ↔ email consistency WITHOUT
    // printing any token).
    for (const t of tokens) {
      const row = await prisma.passwordResetToken.findUnique({
        where: { tokenHash: sha256(t) },
      });
      expect(row, 'emailed token must exist in the DB').not.toBeNull();
      expect(row!.userId).toBe(userId);
      expect(row!.usedAt).toBeNull();
      expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    }

    // Distinct job dedupe identities (the collision surface before the fix).
    const jobs = await prisma.job.findMany({
      where: {
        type: 'SEND_NOTIFICATION',
        OR: notifications.map((n) => ({
          payload: { path: ['notificationId'], equals: n.id },
        })),
      },
    });
    expect(jobs).toHaveLength(2);
    expect(jobs[0].dedupeKey).not.toBe(jobs[1].dedupeKey);
    // The discriminator is the sha256 of each token — the RAW token must not
    // appear anywhere in the dedupe key (one-way leak check).
    for (let i = 0; i < 2; i++) {
      const key = jobs[i].dedupeKey ?? '';
      expect(key).toContain(sha256(tokens[i]));
      expect(key).not.toContain(tokens[i]);
    }
  }, 30_000);

  it('3: the newest token validates and resets the password end-to-end; replay fails with the generic error', async () => {
    const latest = await prisma.notification.findFirst({
      where: { email, template: 'PASSWORD_RESET' },
      orderBy: { createdAt: 'desc' },
    });
    const token = extractToken(latest!.bodyText);
    const NEW_PASSWORD = 'FreshTest#9pass'; // ephemeral test fixture, not a secret

    const result = await resetPassword({ token, password: NEW_PASSWORD });
    expect(result.reset).toBe(true);

    // single-use: replaying the same token fails with the generic message
    await expect(resetPassword({ token, password: NEW_PASSWORD })).rejects.toThrow(
      /invalid or has expired/i
    );

    // the new password authenticates; the old one no longer does
    const auth = await loginUser({ email, password: NEW_PASSWORD });
    expect(auth.user.email).toBe(email);
    await expect(loginUser({ email, password: INITIAL_PASSWORD })).rejects.toThrow(
      /Invalid email or password/
    );
  }, 30_000);

  it('4: other templates keep window dedupe (WELCOME without dedupeExtra is sent once per window)', async () => {
    const welcomeEmail = testEmail('welcomedup');
    const startBucket = bucketOf();

    const first = await queueNotification({
      template: 'WELCOME',
      email: welcomeEmail,
      vars: { name: 'Dup Check' },
    });
    const second = await queueNotification({
      template: 'WELCOME',
      email: welcomeEmail,
      vars: { name: 'Dup Check' },
    });

    if (bucketOf() !== startBucket) {
      throw new Error('test crossed a 10-minute dedupe boundary; re-run');
    }

    expect(first).not.toBeNull();
    expect(second).toBeNull(); // unchanged window dedupe for other templates
    expect(await prisma.notification.count({ where: { email: welcomeEmail } })).toBe(1);
  }, 30_000);
});
