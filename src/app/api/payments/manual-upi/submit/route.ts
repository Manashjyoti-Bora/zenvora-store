import { z } from 'zod';
import { apiRoute, jsonOk, badRequest, conflict } from '@/lib/errors';
import { findOrderForAccess } from '@/lib/orders/access';
import { getCurrentUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { assertRateLimit } from '@/lib/rate-limit';
import { clientIp, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

const submitUtrSchema = z.object({
  orderNumber: z.string().min(1),
  utr: z
    .string()
    .trim()
    .min(8, 'UTR must be at least 8 characters')
    .max(30, 'UTR must not exceed 30 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'UTR contains invalid characters'),
  email: z.string().email().optional().nullable(),
});

export const POST = apiRoute(async (req: Request) => {
  const ip = clientIp(req) ?? 'local';
  await assertRateLimit(`pay-utr:${ip}`, { limit: 15, windowMs: 10 * 60_000 });

  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = submitUtrSchema.parse(raw);

  const user = await getCurrentUser();
  const order = await findOrderForAccess(body.orderNumber, user, body.email ?? null);

  if (order.paymentMethod !== 'MANUAL_UPI') {
    throw badRequest('This order is not configured for manual UPI payment.');
  }

  if (order.paymentStatus === 'PAID') {
    throw conflict('This order is already marked as paid.');
  }

  if (['CANCELLED', 'REFUNDED'].includes(order.status)) {
    throw conflict(`Cannot submit payment for an order that is ${order.status.toLowerCase()}.`);
  }

  // Prevent duplicate UTR across different orders
  const duplicate = await prisma.order.findFirst({
    where: {
      upiUtr: body.utr,
      id: { not: order.id },
      paymentStatus: { in: ['PAID', 'PENDING_VERIFICATION'] },
    },
    select: { orderNumber: true },
  });

  if (duplicate) {
    throw conflict('This transaction reference (UTR) has already been submitted for another order.');
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          upiUtr: body.utr,
          upiSubmittedAt: new Date(),
          upiRejectionReason: null,
          paymentStatus: 'PENDING_VERIFICATION',
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'PAYMENT_ATTEMPTED',
          message: `Customer submitted UPI UTR ${body.utr} for verification`,
          actorType: user ? 'CUSTOMER' : 'SYSTEM',
          actorId: user?.id ?? null,
          data: { utr: body.utr },
        },
      });
    });
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      err.code === 'P2002'
    ) {
      throw conflict('This transaction reference (UTR) has already been submitted for another order.');
    }
    throw err;
  }

  return jsonOk({
    ok: true,
    message: 'Transaction reference submitted successfully. Our team will verify it shortly.',
  });
});
