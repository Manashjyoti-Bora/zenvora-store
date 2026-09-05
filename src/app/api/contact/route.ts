import { apiRoute, jsonOk, badRequest } from '@/lib/errors';
import { contactSchema } from '@/lib/validation/schemas';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { queueNotification } from '@/lib/notifications/notify';
import { assertRateLimit } from '@/lib/rate-limit';
import { clientIp, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(async (req: Request) => {
  const ip = clientIp(req) ?? 'local';
  assertRateLimit(`contact:${ip}`, { limit: 5, windowMs: 30 * 60_000 });

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

  const settings = await getSettings();
  await queueNotification({
    template: 'CONTACT_MESSAGE_ADMIN',
    email: settings.supportEmail,
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
