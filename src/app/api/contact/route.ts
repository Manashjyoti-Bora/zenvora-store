import { apiRoute, jsonOk, badRequest } from '@/lib/errors';
import { contactSchema } from '@/lib/validation/schemas';
import { prisma } from '@/lib/db';
import { configuredSupportEmail, getSettings, isPlaceholderEmail } from '@/lib/settings';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { queueNotification } from '@/lib/notifications/notify';
import { assertRateLimit } from '@/lib/rate-limit';
import { clientIp, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(async (req: Request) => {
  const ip = clientIp(req) ?? 'local';
  await assertRateLimit(`contact:${ip}`, { limit: 5, windowMs: 30 * 60_000 });

  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = contactSchema.parse(raw);

  const message = await prisma.contactMessage.create({
    data: {
      name: body.name,
      email: body.email,
      subject: body.subject || null,
      message: body.message,
    },
  });

  // Notify the support mailbox, or ADMIN_EMAIL while the support address is
  // still the shipped placeholder. If neither is real, the message is still
  // stored above and visible in Admin → Messages; we just don't queue an
  // e-mail that would bounce.
  const settings = await getSettings();
  const notifyEmail =
    configuredSupportEmail(settings) ??
    (isPlaceholderEmail(env.ADMIN_EMAIL) ? null : (env.ADMIN_EMAIL ?? null));
  if (!notifyEmail) {
    logger.warn('Contact message stored but not e-mailed: no real support/admin address configured', {
      messageId: message.id,
    });
    return jsonOk({ received: true }, { status: 201 });
  }
  await queueNotification({
    template: 'CONTACT_MESSAGE_ADMIN',
    email: notifyEmail,
    relatedType: 'ContactMessage',
    relatedId: message.id,
    vars: {
      name: body.name,
      email: body.email,
      subject: body.subject || '(no subject)',
      message: body.message,
      adminUrl: `${process.env.APP_URL ?? ''}/admin/messages`,
    },
  });

  return jsonOk({ received: true }, { status: 201 });
});
