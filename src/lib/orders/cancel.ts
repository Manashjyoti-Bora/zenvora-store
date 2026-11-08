import { prisma } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import { toPaise, formatINR } from '../money';
import { getSettings } from '../settings';
import { auditLog } from '../audit';
import { canTransition } from './state';
import { restockOrderItems } from './inventory';
import { enqueueJobInTransaction, kickJobRunner } from '../jobs/queue';
import { processRefundReservation, reserveRefund } from '../payments/refunds';
import { reservedRefundTotalPaise } from '../payments/refund-accounting';
import { queueNotification } from '../notifications/notify';
import { renderOrderEmailVars } from '../notifications/order-vars';
import type { OrderActorType } from '@prisma/client';

/**
 * Cancellation state and its refund reservation commit together. Provider calls
 * occur only after that durable reservation exists, and an ambiguous provider
 * outcome remains reserved for reconciliation rather than being retried here.
 */
export interface CancelOrderInput {
  orderId: string;
  actorType: OrderActorType;
  actorId?: string | null;
  reason: string;
  force?: boolean;
  refund?: boolean;
}

export async function cancelOrder(
  input: CancelOrderInput
): Promise<{ status: string; refundInitiated: boolean }> {
  const settings = await getSettings();
  const outcome = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "orders" WHERE "id" = ${input.orderId} FOR UPDATE
    `;
      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        include: { items: true, supplierOrders: true, payments: true, user: true, refunds: true },
      });
      if (!order) throw notFound('Order not found');
      if (
        order.cancelledAt ||
        ['CANCELLED', 'REFUNDED', 'RETURNED', 'DELIVERED'].includes(order.status)
      ) {
        throw conflict(
          `This order cannot be cancelled (current status: ${order.status.replace(/_/g, ' ')}).`
        );
      }

      const isAdmin = input.actorType === 'ADMIN';
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

      const shouldRefund =
        paid &&
        ['PREPAID_GATEWAY', 'COD'].includes(order.paymentMethod) &&
        (isAdmin ? input.refund !== false : true);
      const paidGatewayPaise = order.payments
        .filter((payment) => ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(payment.status))
        .reduce((sum, payment) => sum + toPaise(payment.amount), 0);
      const codCollectedPaise =
        order.paymentMethod === 'COD' && paid ? toPaise(order.grandTotal) : 0;
      const refundBalancePaise = Math.max(
        0,
        paidGatewayPaise +
          codCollectedPaise -
          reservedRefundTotalPaise(
            order.refunds.map((refund) => ({
              amountPaise: toPaise(refund.amount),
              status: refund.status,
            }))
          )
      );
      if (shouldRefund && refundBalancePaise <= 0) {
        throw conflict(
          'No verified refundable balance remains; reconcile the existing refund records first.'
        );
      }

      const nextStatus = shouldRefund ? 'REFUND_PENDING' : 'CANCELLED';
      if (order.status !== nextStatus && !canTransition(order.status, nextStatus)) {
        if (shouldRefund) {
          throw conflict(`Cannot safely reserve a refund while order is in ${order.status}.`);
        }
      }
      await tx.order.update({
        where: { id: order.id },
        data: {
          ...(canTransition(order.status, nextStatus) ? { status: nextStatus } : {}),
          cancelledAt: new Date(),
          cancelReason: input.reason,
          cancelledBy: input.actorType,
          fulfilmentStatus: 'CANCELLED',
        },
      });

      if (canTransition(order.status, nextStatus)) {
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            type: 'STATUS_TRANSITION',
            fromStatus: order.status,
            toStatus: nextStatus,
            message: shouldRefund
              ? `Cancellation recorded; refund reserved: ${input.reason}`
              : `Cancelled: ${input.reason}`,
            actorType: input.actorType,
            actorId: input.actorId ?? null,
          },
        });
      } else {
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            type: 'CANCELLATION_REQUESTED',
            message: `Cancellation recorded; status transition unavailable from ${order.status}: ${input.reason}`,
            actorType: input.actorType,
            actorId: input.actorId ?? null,
          },
        });
      }

      const reservation = shouldRefund
        ? await reserveRefund(tx, {
            orderId: order.id,
            amountPaise: refundBalancePaise,
            reason: `Order cancelled: ${input.reason}`,
            actor: input.actorType,
            actorId: input.actorId ?? null,
          })
        : null;

      // The supplier cancellation request is durable in the same transaction
      // as the order cancellation. If queue persistence fails, the cancellation
      // rolls back instead of leaving a cancelled order with no supplier action.
      for (const supplierOrder of order.supplierOrders) {
        if (['QUEUED', 'SENT', 'ACCEPTED', 'PROCESSING'].includes(supplierOrder.status)) {
          await enqueueJobInTransaction(tx, {
            type: 'CANCEL_SUPPLIER_ORDER',
            payload: { supplierOrderId: supplierOrder.id, reason: input.reason },
            dedupeKey: `cancel_${supplierOrder.id}`,
          });
          await tx.supplierOrder.update({
            where: { id: supplierOrder.id },
            data: {
              cancellationStatus: 'REQUESTED',
              cancellationMessage: input.reason,
            },
          });
        }
      }
      return { order, reservation, shouldRefund, refundBalancePaise, nextStatus };
    },
    { isolationLevel: 'Serializable' }
  );

  // Durable supplier-cancellation jobs were committed with the order state.
  // This only requests prompt processing; the cron queue remains the backstop.
  kickJobRunner();

  if (!['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(outcome.order.status)) {
    await restockOrderItems({
      orderId: outcome.order.id,
      reason: 'ORDER_CANCELLED',
      actorId: input.actorId ?? null,
    });
  }

  let refundStatus: string | undefined;
  if (outcome.reservation) {
    const processed = await processRefundReservation(
      outcome.reservation,
      `Order cancelled: ${input.reason}`
    );
    refundStatus = processed.status;
  }
  const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: outcome.order.id } });
  const finalStatus = finalOrder.status;

  await auditLog({
    actor: input.actorId ? { id: input.actorId } : null,
    action: 'order.cancelled',
    entityType: 'Order',
    entityId: outcome.order.id,
    data: {
      reason: input.reason,
      refund: outcome.shouldRefund,
      refundId: outcome.reservation?.refundId ?? null,
      refundAmountPaise: outcome.reservation?.amountPaise ?? 0,
      finalStatus,
    },
  });

  const vars = await renderOrderEmailVars(outcome.order.id);
  await queueNotification({
    template: 'ORDER_CANCELLED',
    email: outcome.order.guestEmail ?? vars.email,
    userId: outcome.order.userId,
    orderId: outcome.order.id,
    vars: {
      ...vars,
      reason: input.reason,
      refundNote: outcome.reservation
        ? `A refund of ${formatINR(outcome.refundBalancePaise)} is reserved. Current settlement status: ${refundStatus ?? outcome.reservation.status}.`
        : '',
    },
    skipIfNoEmail: true,
  });

  return { status: finalStatus, refundInitiated: Boolean(outcome.reservation) };
}

/** Is this order cancellable by the customer right now? (UI helper) */
export async function customerCanCancel(
  orderId: string
): Promise<{ can: boolean; reason?: string }> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return { can: false, reason: 'Order not found' };
  if (order.cancelledAt) return { can: false, reason: 'A cancellation is already recorded' };
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
