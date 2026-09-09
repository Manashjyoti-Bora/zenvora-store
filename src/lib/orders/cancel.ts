import { prisma } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import { toPaise, formatINR } from '../money';
import { getSettings } from '../settings';
import { auditLog } from '../audit';
import { transitionOrder, recordOrderEvent, canTransition } from './state';
import { restockOrderItems } from './inventory';
import { enqueueJob, kickJobRunner } from '../jobs/queue';
import { createRefund } from '../payments/refunds';
import { queueNotification } from '../notifications/notify';
import { renderOrderEmailVars } from '../notifications/order-vars';
import type { OrderActorType } from '@prisma/client';

/**
 * Order cancellation.
 *
 * Customer rules (from store settings):
 *  - Unpaid orders: cancellable any time.
 *  - Paid orders: cancellable only while fulfilment has NOT started
 *    (fulfilmentStatus PENDING) and within `cancellationWindowHours` of
 *    placement. A full refund is initiated automatically.
 *  - Once sent to the supplier/shipped: customer cancellation is refused with
 *    an honest message; admins may force-cancel (and should coordinate with
 *    the supplier manually or via the cancellation job).
 *
 * Admin rules: can cancel anything not DELIVERED/RETURNED, optionally with a
 * refund. Supplier cancellation requests are queued (best effort, capability
 * dependent).
 */

export interface CancelOrderInput {
  orderId: string;
  actorType: OrderActorType;
  actorId?: string | null;
  reason: string;
  /** Admin-only: allow cancelling even after fulfilment started. */
  force?: boolean;
  /** Admin-only choice; customers always get an automatic refund when paid. */
  refund?: boolean;
}

export async function cancelOrder(
  input: CancelOrderInput
): Promise<{ status: string; refundInitiated: boolean }> {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: { items: true, supplierOrders: true, payments: true, user: true },
  });
  if (!order) throw notFound('Order not found');

  if (['CANCELLED', 'REFUNDED', 'RETURNED', 'DELIVERED'].includes(order.status)) {
    throw conflict(
      `This order cannot be cancelled (current status: ${order.status.replace(/_/g, ' ')}).`
    );
  }

  const isAdmin = input.actorType === 'ADMIN';
  const settings = await getSettings();
  const paid = order.paymentStatus === 'PAID' || order.paymentStatus === 'PARTIALLY_REFUNDED';
  const fulfilmentStarted = order.fulfilmentStatus !== 'PENDING';

  if (!isAdmin) {
    if (paid && fulfilmentStarted) {
      throw badRequest(
        'Your order is already being prepared or shipped and can no longer be cancelled online. Please contact support - you may still be able to return it after delivery.'
      );
    }
    if (paid) {
      const windowMs = settings.policies.cancellationWindowHours * 3600_000;
      const placedAt = order.paidAt ?? order.placedAt ?? order.createdAt;
      if (windowMs > 0 && Date.now() - placedAt.getTime() > windowMs) {
        throw badRequest(
          `The cancellation window (${settings.policies.cancellationWindowHours}h after payment) has passed. Please contact support.`
        );
      }
    }
  } else if (
    fulfilmentStarted &&
    !input.force &&
    ['SHIPPED', 'OUT_FOR_DELIVERY'].includes(order.status)
  ) {
    throw conflict(
      'Order has shipped. Use force-cancel only after coordinating with the supplier and customer.'
    );
  }

  // Best-effort supplier cancellation for anything already sent.
  for (const so of order.supplierOrders) {
    if (['QUEUED', 'SENT', 'ACCEPTED', 'PROCESSING'].includes(so.status)) {
      await enqueueJob({
        type: 'CANCEL_SUPPLIER_ORDER',
        payload: { supplierOrderId: so.id, reason: input.reason },
        dedupeKey: `cancel_${so.id}`,
      });
    }
  }
  kickJobRunner();

  // Restore LOCAL-mode stock (only meaningful before shipping). Transactional
  // and idempotent per reason; writes InventoryMovement history rows.
  if (!['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.status)) {
    await restockOrderItems({
      orderId: order.id,
      reason: 'ORDER_CANCELLED',
      actorId: input.actorId ?? null,
    });
  }

  const shouldRefund =
    paid && order.paymentMethod === 'PREPAID_GATEWAY' && (isAdmin ? input.refund !== false : true);

  await prisma.order.update({
    where: { id: order.id },
    data: {
      cancelledAt: new Date(),
      cancelReason: input.reason,
      cancelledBy: input.actorType,
      fulfilmentStatus: 'CANCELLED',
    },
  });

  let finalStatus = order.status;
  if (shouldRefund) {
    const refundable = toPaise(order.grandTotal) - toPaise(order.refundedTotal);
    if (refundable > 0) {
      await createRefund({
        orderId: order.id,
        amountPaise: refundable,
        reason: `Order cancelled: ${input.reason}`,
        actor: input.actorType,
        actorId: input.actorId ?? null,
      });
      const refreshed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      finalStatus = refreshed.status; // refund flow drives REFUND_PENDING/REFUNDED
    }
  } else if (canTransition(order.status, 'CANCELLED')) {
    await transitionOrder({
      orderId: order.id,
      to: 'CANCELLED',
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      set: { fulfilmentStatus: 'CANCELLED' },
      message: `Cancelled: ${input.reason}`,
    });
    finalStatus = 'CANCELLED';
  } else {
    await recordOrderEvent({
      orderId: order.id,
      type: 'CANCELLATION_REQUESTED',
      message: `Cancellation recorded (status transition to CANCELLED not possible from ${order.status}): ${input.reason}`,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
    });
  }

  await auditLog({
    actor: input.actorId ? { id: input.actorId } : null,
    action: 'order.cancelled',
    entityType: 'Order',
    entityId: order.id,
    data: { reason: input.reason, refund: shouldRefund, finalStatus },
  });

  const vars = await renderOrderEmailVars(order.id);
  await queueNotification({
    template: 'ORDER_CANCELLED',
    email: order.guestEmail ?? vars.email,
    userId: order.userId,
    orderId: order.id,
    vars: {
      ...vars,
      reason: input.reason,
      refundNote: shouldRefund
        ? `A refund of ${formatINR(toPaise(order.grandTotal) - toPaise(order.refundedTotal))} has been initiated and will reflect per your payment provider's timelines.`
        : '',
    },
    skipIfNoEmail: true,
  });

  return { status: finalStatus, refundInitiated: shouldRefund };
}

/** Is this order cancellable by the customer right now? (UI helper) */
export async function customerCanCancel(
  orderId: string
): Promise<{ can: boolean; reason?: string }> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return { can: false, reason: 'Order not found' };
  if (
    ['CANCELLED', 'REFUNDED', 'RETURNED', 'DELIVERED', 'SHIPPED', 'OUT_FOR_DELIVERY'].includes(
      order.status
    )
  ) {
    return {
      can: false,
      reason: `Orders with status ${order.status.replace(/_/g, ' ')} cannot be cancelled online`,
    };
  }
  const settings = await getSettings();
  const paid = order.paymentStatus === 'PAID';
  if (paid && order.fulfilmentStatus !== 'PENDING') {
    return { can: false, reason: 'Fulfilment has already started' };
  }
  if (paid) {
    const windowMs = settings.policies.cancellationWindowHours * 3600_000;
    const placedAt = order.paidAt ?? order.placedAt ?? order.createdAt;
    if (windowMs > 0 && Date.now() - placedAt.getTime() > windowMs) {
      return { can: false, reason: 'Cancellation window has passed' };
    }
  }
  return { can: true };
}
