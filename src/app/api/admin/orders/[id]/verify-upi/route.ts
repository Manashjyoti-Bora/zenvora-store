import { z } from 'zod';
import { apiRoute, jsonOk, notFound, conflict, badRequest } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { confirmOrderForFulfilment } from '@/lib/payments/confirm';
import { auditLog } from '@/lib/audit';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const verifyUpiSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().trim().max(300).optional().nullable(),
});

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;

    const raw = await readJson(req);
    if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
    const body = verifyUpiSchema.parse(raw);

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) throw notFound('Order not found');

    if (order.paymentMethod !== 'MANUAL_UPI') {
      throw conflict('This action is only available for Manual UPI orders.');
    }

    if (order.paymentStatus === 'PAID') {
      throw conflict('Order is already marked as paid.');
    }

    if (['CANCELLED', 'REFUNDED'].includes(order.status)) {
      throw conflict(`Cannot verify payment for an order that is ${order.status.toLowerCase()}.`);
    }

    if (!order.upiUtr) {
      throw conflict('Customer has not submitted a transaction reference (UTR) yet.');
    }

    if (body.decision === 'REJECT') {
      const reason = body.reason || 'Transaction reference not found in bank statement';
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: {
            paymentStatus: 'FAILED',
            upiRejectionReason: reason,
          },
        });
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            type: 'PAYMENT_FAILED',
            message: `Admin rejected UPI reference ${order.upiUtr}: ${reason}`,
            actorType: 'ADMIN',
            actorId: admin.id,
            data: { utr: order.upiUtr, reason },
          },
        });
      });

      await auditLog({
        actor: { id: admin.id },
        action: 'payment.upi_rejected',
        entityType: 'Order',
        entityId: order.id,
        data: { utr: order.upiUtr, reason },
      });

      return jsonOk({ verified: false, status: 'FAILED' });
    }

    // APPROVE decision: only update payment and order statuses using server-side records
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: 'PAID',
          paidAt: new Date(),
          status: 'PAYMENT_VERIFIED',
          upiVerifiedAt: new Date(),
          upiVerifiedBy: admin.id,
          upiRejectionReason: null,
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'STATUS_TRANSITION',
          fromStatus: order.status,
          toStatus: 'PAYMENT_VERIFIED',
          message: `Manual UPI payment verified (UTR: ${order.upiUtr}) by admin`,
          actorType: 'ADMIN',
          actorId: admin.id,
          data: { utr: order.upiUtr },
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: 'PAYMENT_CAPTURED',
          message: `Captured ${order.grandTotal.toString()} INR via Manual UPI`,
          actorType: 'ADMIN',
          actorId: admin.id,
          data: { utr: order.upiUtr, method: 'manual-upi' },
        },
      });
    });

    await confirmOrderForFulfilment(order.id, 'ADMIN', admin.id);

    await auditLog({
      actor: { id: admin.id },
      action: 'payment.upi_verified',
      entityType: 'Order',
      entityId: order.id,
      data: { utr: order.upiUtr },
    });

    return jsonOk({ verified: true, status: 'PAID' });
  })(req, ctx);
}
