import { prisma } from '../db';
import { env } from '../env';
import { logger } from '../logger';
import { getSettings } from '../settings';
import { sha256 } from '../crypto';
import { enqueueJob, kickJobRunner } from '../jobs/queue';
import { renderTemplate, type TemplateVars } from './templates';
import { getEmailProvider } from './providers';
import type { NotificationTemplate } from '@prisma/client';

/**
 * Notification pipeline.
 *
 * queueNotification() renders the email from real data NOW (so content is
 * frozen even if settings change), stores it in the `notifications` table,
 * and enqueues a durable SEND_NOTIFICATION job. Delivery failures are
 * recorded (status FAILED + error) and visible in the admin panel - nothing
 * fails silently.
 *
 * De-duplication: identical (template, order, recipient) notifications inside
 * a 10-minute window are dropped ONLY while a delivery is genuinely in flight
 * (job PENDING/RUNNING) or has already been SENT inside the window. A
 * stranded, failed or cancelled previous attempt never blocks a legitimate
 * retry — otherwise a single stale row could swallow every recovery request
 * (e.g. password resets) for the rest of the window, which is exactly what
 * happened in production.
 */

export interface QueueNotificationInput {
  template: NotificationTemplate;
  email: string;
  userId?: string | null;
  orderId?: string | null;
  relatedType?: string;
  relatedId?: string;
  vars: TemplateVars;
  /** Skip silently when no email address is known (guest flows). */
  skipIfNoEmail?: boolean;
  /** Extra dedupe discriminator (e.g. shipment id). */
  dedupeExtra?: string;
}

/** Safely extract the notificationId from a job's JSON payload. */
function payloadNotificationId(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'notificationId' in payload) {
    const value = (payload as { notificationId?: unknown }).notificationId;
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

export async function queueNotification(input: QueueNotificationInput): Promise<string | null> {
  const email = input.email?.trim().toLowerCase() ?? '';
  if (!email || !email.includes('@')) {
    if (input.skipIfNoEmail) return null;
    logger.warn('Notification skipped: invalid recipient email', {
      template: input.template,
      orderId: input.orderId,
    });
    return null;
  }

  const settings = await getSettings();
  let rendered;
  try {
    rendered = renderTemplate(input.template, input.vars, {
      storeName: settings.storeName,
      supportEmail: settings.supportEmail,
      appUrl: env.APP_URL,
    });
  } catch (err) {
    logger.error('Failed to render notification template', {
      template: input.template,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const bucket = Math.floor(Date.now() / 600_000); // 10-minute dedupe window
  const dedupeKey = [
    'ntf',
    input.template,
    input.orderId ?? input.relatedId ?? '-',
    sha256(email).slice(0, 10),
    bucket,
    input.dedupeExtra ?? '',
  ].join(':');

  const existing = await prisma.job.findUnique({ where: { dedupeKey } });
  if (existing) {
    if (existing.status === 'PENDING' || existing.status === 'RUNNING') {
      // A delivery for this window is already on record — never create a
      // second email. But ALWAYS kick the runner: a PENDING job stranded by
      // an older deployment (or a crashed worker) must not become a dead end
      // for the whole window. The kick processes it within seconds.
      logger.info('Notification de-duplicated (delivery already in flight)', {
        template: input.template,
        dedupeKey,
        jobStatus: existing.status,
      });
      kickJobRunner();
      return null;
    }

    // Finished job (DONE/FAILED/CANCELLED): this only counts as a duplicate
    // when the email was actually SENT. Anything else — FAILED delivery,
    // cancelled job, orphaned QUEUED notification, missing row — means the
    // window produced no email, so a retry is legitimate (with fresh content,
    // e.g. a fresh password-reset token). enqueueJob's unique-key branch
    // requeues the finished job row with the new payload.
    const previousId = payloadNotificationId(existing.payload);
    const previous = previousId
      ? await prisma.notification.findUnique({ where: { id: previousId } })
      : null;
    if (previous?.status === 'SENT') {
      logger.info('Notification de-duplicated (already sent inside window)', {
        template: input.template,
        dedupeKey,
      });
      return null;
    }
    logger.info('Retrying notification: previous attempt inside window was not delivered', {
      template: input.template,
      dedupeKey,
      previousJobStatus: existing.status,
      previousNotificationStatus: previous?.status ?? 'MISSING',
    });
  }

  const notification = await prisma.notification.create({
    data: {
      template: input.template,
      channel: 'EMAIL',
      email,
      userId: input.userId ?? null,
      orderId: input.orderId ?? null,
      relatedType: input.relatedType ?? null,
      relatedId: input.relatedId ?? null,
      subject: rendered.subject,
      bodyHtml: rendered.html,
      bodyText: rendered.text,
      status: 'QUEUED',
    },
  });

  await enqueueJob({
    type: 'SEND_NOTIFICATION',
    payload: { notificationId: notification.id },
    dedupeKey,
  });
  kickJobRunner();
  return notification.id;
}

/** Job handler: deliver one queued notification. */
export async function dispatchNotification(notificationId: string): Promise<void> {
  const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notification || notification.status === 'SENT') return;

  const provider = getEmailProvider();
  if (provider.name === 'smtp' && !provider.isConfigured()) {
    await prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: 'FAILED',
        provider: 'smtp',
        error:
          'SMTP is not fully configured (SMTP_HOST/SMTP_USER/SMTP_PASS). See SETUP_CHECKLIST.md.',
      },
    });
    return;
  }

  try {
    await provider.send({
      to: notification.email,
      subject: notification.subject,
      html: notification.bodyHtml ?? '',
      text: notification.bodyText ?? undefined,
    });
    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: 'SENT', provider: provider.name, sentAt: new Date(), error: null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Notification delivery failed', { notificationId, error: message });
    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: 'FAILED', provider: provider.name, error: message.slice(0, 500) },
    });
    throw err; // let the job runner apply retry/backoff policy
  }
}
