import { prisma } from '../db';
import { withSerializableTransactionRetry } from '../db-transaction';
import { conflict } from '../errors';
import { toPaise } from '../money';
import { logger } from '../logger';
import { auditLog } from '../audit';
import { getSettings } from '../settings';
import { estimatePaymentFeePaise } from '../checkout/calc';
import { recordOrderEvent, canTransition } from '../orders/state';
import { processRefundReservation, reserveRefund } from './refunds';
import { reservedRefundTotalPaise } from './refund-accounting';
import { enqueueOrderFulfilment } from '../orders/fulfilment';
import { recalcOrderFinancials } from '../orders/finance';
import { queueNotification } from '../notifications/notify';
import { renderOrderEmailVars } from '../notifications/order-vars';
import { sanitizeForLog } from '../logger';
import { Prisma } from '@prisma/client';
import type { OrderActorType } from '@prisma/client';
import type { PaymentProviderKind } from './types';

/**
 * Single authoritative payment-confirmation pipeline.
 *
 * EVERY payment outcome - Razorpay webhook, server-side verify after
 * Checkout.js, and the dev-only TEST simulator - funnels through here, so
 * behaviour and idempotency are identical no matter the source. The frontend
 * is never trusted: callers must have independently verified the outcome
 * (gateway fetch and/or HMAC signature) before calling with outcome=PAID.
 */

export interface PaymentResultInput {
  orderId: string;
  provider: PaymentProviderKind;
  providerOrderId: string;
  providerPaymentId?: string | null;
  outcome: 'PAID' | 'FAILED';
  amountPaise?: number | null;
  method?: string | null;
  feePaise?: number | null;
  failureReason?: string | null;
  verifiedVia?: string;
  raw?: Record<string, unknown> | null;
  actorType?: OrderActorType;
}

export type ConfirmOutcome =
  | 'CONFIRMED'
  | 'DUPLICATE'
  | 'FAILED_RECORDED'
  | 'REJECTED_AMOUNT_MISMATCH'
  | 'ORDER_NOT_PAYABLE'
  | 'CAPTURED_REQUIRES_REFUND';

const dec = (paise: number) => (paise / 100).toFixed(2);

export async function confirmPaymentResult(
  input: PaymentResultInput
): Promise<{ outcome: ConfirmOutcome; orderNumber: string }> {
  const actorType = input.actorType ?? 'PAYMENT_PROVIDER';
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: { payments: true, user: true },
  });
  if (!order) throw new Error(`Order not found for payment confirmation: ${input.orderId}`);

  if (
    input.outcome === 'FAILED' &&
    ['CANCELLED', 'REFUNDED', 'REFUND_PENDING'].includes(order.status)
  ) {
    await recordOrderEvent({
      orderId: order.id,
      type: 'PAYMENT_IGNORED',
      message: `Payment failure result ignored: order is ${order.status}`,
      actorType,
      data: { providerOrderId: input.providerOrderId },
    });
    return { outcome: 'ORDER_NOT_PAYABLE', orderNumber: order.orderNumber };
  }

  // --- FAILED outcome --------------------------------------------------------
  if (input.outcome === 'FAILED') {
    const failed = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "orders" WHERE "id" = ${order.id} FOR UPDATE
      `;
      const locked = await tx.order.findUnique({
        where: { id: order.id },
        include: { payments: true },
      });
      if (!locked) return { ignored: true, notify: false };
      if (['CANCELLED', 'REFUNDED', 'REFUND_PENDING'].includes(locked.status)) {
        await tx.orderEvent.create({
          data: {
            orderId: locked.id,
            type: 'PAYMENT_IGNORED',
            message: `Payment failure result ignored: order is ${locked.status}`,
            actorType,
            data: { providerOrderId: input.providerOrderId },
          },
        });
        return { ignored: true, notify: false };
      }
      const previousAttempt = locked.payments.find(
        (payment) => payment.providerOrderId === input.providerOrderId
      );
      if (
        previousAttempt &&
        ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(previousAttempt.status)
      ) {
        await tx.orderEvent.create({
          data: {
            orderId: locked.id,
            type: 'PAYMENT_IGNORED',
            message: 'Late payment failure ignored: payment was already captured',
            actorType,
            data: { providerOrderId: input.providerOrderId, paymentId: previousAttempt.id },
          },
        });
        return { ignored: true, notify: false };
      }
      await upsertPaymentRow(tx, input, locked.id, 'FAILED');
      const anyPaid = locked.payments.some((payment) =>
        ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(payment.status)
      );
      const shouldTransition =
        !anyPaid && locked.paymentStatus === 'PENDING' && locked.status === 'PENDING_PAYMENT';
      if (shouldTransition) {
        const moved = await tx.order.updateMany({
          where: { id: locked.id, status: 'PENDING_PAYMENT' },
          data: { paymentStatus: 'FAILED', status: 'PAYMENT_FAILED' },
        });
        if (moved.count !== 1)
          throw new Error('Order changed during payment failure finalization.');
        await tx.orderEvent.create({
          data: {
            orderId: locked.id,
            type: 'STATUS_TRANSITION',
            fromStatus: 'PENDING_PAYMENT',
            toStatus: 'PAYMENT_FAILED',
            message: input.failureReason ?? 'Payment failed',
            actorType,
            data: { providerOrderId: input.providerOrderId },
          },
        });
      }
      await tx.orderEvent.create({
        data: {
          orderId: locked.id,
          type: 'PAYMENT_FAILED',
          message: input.failureReason ?? 'Payment failed',
          actorType,
          data: { providerOrderId: input.providerOrderId, provider: input.provider },
        },
      });
      return { ignored: false, notify: shouldTransition };
    });
    if (failed.notify) {
      const vars = await renderOrderEmailVars(order.id);
      await queueNotification({
        template: 'PAYMENT_FAILED',
        email: order.user?.email ?? order.guestEmail ?? '',
        userId: order.userId,
        orderId: order.id,
        vars,
        skipIfNoEmail: true,
      });
    }
    return {
      outcome: failed.ignored ? 'ORDER_NOT_PAYABLE' : 'FAILED_RECORDED',
      orderNumber: order.orderNumber,
    };
  }

  // --- PAID outcome ----------------------------------------------------------
  if (input.amountPaise != null && input.amountPaise !== toPaise(order.grandTotal)) {
    // Do not fulfil an under/over-captured order, but retain a verified positive
    // capture in the ledger and reserve its full captured amount for manual
    // refund recovery. It is never silently discarded or counted as order value.
    logger.error('Payment amount mismatch - storing capture for recovery', {
      orderId: order.id,
      expected: toPaise(order.grandTotal),
      received: input.amountPaise,
    });
    if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
      await recordOrderEvent({
        orderId: order.id,
        type: 'PAYMENT_AMOUNT_MISMATCH',
        message: `Invalid captured amount ${input.amountPaise} paise; manual provider review required`,
        actorType,
        data: { providerOrderId: input.providerOrderId, received: input.amountPaise },
      });
      return { outcome: 'REJECTED_AMOUNT_MISMATCH', orderNumber: order.orderNumber };
    }

    const mismatch = await withSerializableTransactionRetry(
      async (tx) => {
        await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "orders" WHERE "id" = ${order.id} FOR UPDATE
      `;
        const locked = await tx.order.findUnique({
          where: { id: order.id },
          include: { payments: true },
        });
        if (!locked) throw new Error(`Order not found for payment mismatch: ${order.id}`);
        const existing = locked.payments.find(
          (payment) => payment.providerOrderId === input.providerOrderId
        );
        if (
          existing?.providerPaymentId === (input.providerPaymentId ?? null) &&
          ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(existing.status)
        ) {
          return { duplicate: true, reservation: null };
        }
        if (existing && existing.status !== 'FAILED') {
          await tx.orderEvent.create({
            data: {
              orderId: locked.id,
              type: 'PAYMENT_AMOUNT_MISMATCH',
              message:
                'A second distinct capture used an already-recorded provider order; manual reconciliation required',
              actorType,
              data: { providerOrderId: input.providerOrderId, received: input.amountPaise },
            },
          });
          return { duplicate: false, reservation: null };
        }
        const payment = await upsertPaymentRow(
          tx,
          input,
          locked.id,
          'PAID',
          { feePaise: input.feePaise ?? 0, feeIsEstimate: input.feePaise == null },
          input.amountPaise!
        );
        await tx.order.update({
          where: { id: locked.id },
          data: { paymentStatus: 'PAID', paidAt: locked.paidAt ?? new Date() },
        });
        await tx.orderEvent.create({
          data: {
            orderId: locked.id,
            type: 'PAYMENT_AMOUNT_MISMATCH',
            message: `Captured ${input.amountPaise} paise does not match order total ${toPaise(locked.grandTotal)} paise; refund recovery reserved`,
            actorType,
            data: {
              providerOrderId: input.providerOrderId,
              providerPaymentId: payment.providerPaymentId,
            },
          },
        });
        const priorRefund = await tx.refund.findFirst({
          where: { orderId: locked.id, paymentId: payment.id },
        });
        const reservation = priorRefund
          ? null
          : await reserveRefund(tx, {
              orderId: locked.id,
              amountPaise: input.amountPaise!,
              reason: 'Captured amount does not match order total; manual recovery required',
              actor: 'SYSTEM',
            });
        await recalcOrderFinancials(locked.id, tx);
        return { duplicate: false, reservation };
      },
      { isolationLevel: 'Serializable' }
    );

    if (mismatch.duplicate) return { outcome: 'DUPLICATE', orderNumber: order.orderNumber };
    await auditLog({
      action: 'payment.amount_mismatch_recovery',
      entityType: 'Order',
      entityId: order.id,
      data: { providerOrderId: input.providerOrderId, capturedPaise: input.amountPaise },
    });
    return { outcome: 'CAPTURED_REQUIRES_REFUND', orderNumber: order.orderNumber };
  }

  const settings = await getSettings();
  const feeIsEstimate = input.feePaise == null;
  const feePaise =
    input.feePaise ??
    (order.paymentMethod === 'PREPAID_GATEWAY'
      ? estimatePaymentFeePaise(toPaise(order.grandTotal), settings)
      : 0);

  const capture = await withSerializableTransactionRetry(
    async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "orders" WHERE "id" = ${input.orderId} FOR UPDATE
    `;
      const locked = await tx.order.findUnique({
        where: { id: input.orderId },
        include: { payments: true },
      });
      if (!locked) throw new Error(`Order not found for payment confirmation: ${input.orderId}`);

      const existing = locked.payments.find(
        (payment) => payment.providerOrderId === input.providerOrderId
      );
      if (
        existing &&
        existing.providerPaymentId === (input.providerPaymentId ?? null) &&
        ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(existing.status)
      ) {
        const refundRecoveryState =
          ['CANCELLED', 'REFUND_PENDING', 'REFUNDED'].includes(locked.status) ||
          ['PARTIALLY_REFUNDED', 'REFUNDED'].includes(locked.paymentStatus);
        const needsOrderRepair =
          !refundRecoveryState &&
          (locked.paymentStatus !== 'PAID' ||
            !locked.paidAt ||
            ['PENDING_PAYMENT', 'PAYMENT_FAILED'].includes(locked.status));
        if (!needsOrderRepair) return { kind: 'duplicate' as const, reservation: null };

        // The provider/payment commit may have succeeded immediately before a
        // crash while the order update did not. Repair only the order side of
        // that interrupted confirmation; never rewrite a captured/refunded
        // payment row or manufacture a second capture event.
        const recoveredPaidAt = locked.paidAt ?? existing.paidAt ?? new Date();
        const restorePayableState = ['PENDING_PAYMENT', 'PAYMENT_FAILED'].includes(locked.status);
        await tx.order.update({
          where: { id: locked.id },
          data: {
            paymentStatus: 'PAID',
            paidAt: recoveredPaidAt,
            ...(restorePayableState ? { status: 'PAYMENT_VERIFIED' } : {}),
          },
        });
        await tx.orderEvent.create({
          data: {
            orderId: locked.id,
            type: 'PAYMENT_CAPTURED_RECOVERY',
            message: 'Recovered order state from the durable captured payment',
            actorType,
            data: { providerOrderId: input.providerOrderId, paymentId: existing.id },
          },
        });
        if (restorePayableState) {
          await tx.orderEvent.create({
            data: {
              orderId: locked.id,
              type: 'STATUS_TRANSITION',
              fromStatus: locked.status,
              toStatus: 'PAYMENT_VERIFIED',
              message: 'Payment confirmation recovered after an interrupted commit',
              actorType,
              data: { providerOrderId: input.providerOrderId },
            },
          });
        }
        await recalcOrderFinancials(locked.id, tx);
        return { kind: 'confirmed' as const, reservation: null };
      }

      const payment = await upsertPaymentRow(tx, input, locked.id, 'PAID', {
        feePaise,
        feeIsEstimate,
      });
      const lateCapture = ['CANCELLED', 'REFUND_PENDING', 'REFUNDED'].includes(locked.status);
      if (lateCapture) {
        await tx.order.update({
          where: { id: locked.id },
          data: { paymentStatus: 'PAID', paidAt: locked.paidAt ?? new Date() },
        });
        await tx.orderEvent.create({
          data: {
            orderId: locked.id,
            type: 'PAYMENT_CAPTURED_RECOVERY',
            message:
              'Provider confirmed capture after cancellation/refund finalization; refund recovery required',
            actorType,
            data: { providerOrderId: input.providerOrderId, paymentId: payment.id },
          },
        });
        if (locked.status !== 'REFUND_PENDING' && canTransition(locked.status, 'REFUND_PENDING')) {
          const moved = await tx.order.updateMany({
            where: { id: locked.id, status: locked.status },
            data: { status: 'REFUND_PENDING' },
          });
          if (moved.count !== 1)
            throw new Error('Order changed during late-capture recovery transition.');
          await tx.orderEvent.create({
            data: {
              orderId: locked.id,
              type: 'STATUS_TRANSITION',
              fromStatus: locked.status,
              toStatus: 'REFUND_PENDING',
              message: 'Late provider capture requires refund/reconciliation',
              actorType: 'SYSTEM',
              data: { paymentId: payment.id },
            },
          });
        }
        const priorRefund = await tx.refund.findFirst({
          where: { orderId: locked.id, paymentId: payment.id },
        });
        const [allPayments, allRefunds] = await Promise.all([
          tx.payment.findMany({ where: { orderId: locked.id } }),
          tx.refund.findMany({ where: { orderId: locked.id } }),
        ]);
        const capturedPaise = allPayments
          .filter((row) => ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(row.status))
          .reduce((sum, row) => sum + toPaise(row.amount), 0);
        const reservedPaise = reservedRefundTotalPaise(
          allRefunds.map((refund) => ({
            amountPaise: toPaise(refund.amount),
            status: refund.status,
          }))
        );
        const availablePaise = Math.max(0, capturedPaise - reservedPaise);
        const reservation =
          priorRefund || availablePaise === 0
            ? null
            : await reserveRefund(tx, {
                orderId: locked.id,
                amountPaise: availablePaise,
                reason: 'Late provider capture after cancellation; recovery reservation',
                actor: 'SYSTEM',
              });
        await recalcOrderFinancials(locked.id, tx);
        return { kind: 'recovery' as const, reservation };
      }

      if (!['PENDING_PAYMENT', 'PAYMENT_FAILED'].includes(locked.status)) {
        await tx.orderEvent.create({
          data: {
            orderId: locked.id,
            type: 'PAYMENT_CAPTURED_RECOVERY',
            message: `Provider confirmed capture while order was ${locked.status}; manual review required`,
            actorType,
            data: { providerOrderId: input.providerOrderId, paymentId: payment.id },
          },
        });
        await recalcOrderFinancials(locked.id, tx);
        return { kind: 'recovery' as const, reservation: null };
      }

      const changed = await tx.order.updateMany({
        where: { id: locked.id, status: locked.status },
        data: {
          paymentStatus: 'PAID',
          paidAt: locked.paidAt ?? new Date(),
          status: 'PAYMENT_VERIFIED',
        },
      });
      if (changed.count !== 1)
        throw new Error('Order changed during payment capture finalization.');
      await tx.orderEvent.create({
        data: {
          orderId: locked.id,
          type: 'STATUS_TRANSITION',
          fromStatus: locked.status,
          toStatus: 'PAYMENT_VERIFIED',
          message: `Payment verified via ${input.verifiedVia ?? 'gateway'} (${input.provider}${input.providerPaymentId ? ` ${input.providerPaymentId}` : ''})`,
          actorType,
          data: { providerOrderId: input.providerOrderId },
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: locked.id,
          type: 'PAYMENT_CAPTURED',
          message: `Captured ${dec(toPaise(locked.grandTotal))} INR via ${input.provider}`,
          actorType,
          data: sanitizeForLog({
            providerPaymentId: input.providerPaymentId,
            method: input.method,
            feePaise,
            feeIsEstimate,
            raw: input.raw ?? undefined,
          }) as Prisma.InputJsonValue,
        },
      });
      await recalcOrderFinancials(locked.id, tx);
      return { kind: 'confirmed' as const, reservation: null };
    },
    { isolationLevel: 'Serializable' }
  );

  if (capture.reservation) {
    await processRefundReservation(capture.reservation, 'Late provider capture after cancellation');
  }
  if (capture.kind === 'recovery') {
    await auditLog({
      action: 'payment.capture_recovery_required',
      entityType: 'Order',
      entityId: order.id,
      data: {
        providerOrderId: input.providerOrderId,
        reservationCreated: Boolean(capture.reservation),
      },
    });
    return { outcome: 'CAPTURED_REQUIRES_REFUND', orderNumber: order.orderNumber };
  }
  if (capture.kind === 'duplicate') {
    logger.info('Duplicate payment confirmation ignored', { orderId: order.id });
    return { outcome: 'DUPLICATE', orderNumber: order.orderNumber };
  }

  const confirmed = await confirmOrderForFulfilment(order.id, actorType);
  await auditLog({
    action: 'payment.confirmed',
    entityType: 'Order',
    entityId: order.id,
    data: { providerOrderId: input.providerOrderId, via: input.verifiedVia },
  });

  return {
    outcome: confirmed ? 'CONFIRMED' : 'DUPLICATE',
    orderNumber: order.orderNumber,
  };
}

/**
 * Move a paid (or COD) order into fulfilment: ORDER_CONFIRMED, supplier
 * orders queued, confirmation email sent. Idempotent.
 */
export async function confirmOrderForFulfilment(
  orderId: string,
  actorType: OrderActorType = 'SYSTEM',
  actorId?: string | null
): Promise<boolean> {
  const confirmation = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "orders" WHERE "id" = ${orderId} FOR UPDATE
    `;
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) return { shouldQueue: false as const, newlyConfirmed: false, order: null };
    if (['CANCELLED', 'REFUND_PENDING', 'REFUNDED'].includes(order.status)) {
      logger.warn('Fulfilment skipped for cancelled/refund recovery order', {
        orderId,
        status: order.status,
      });
      return { shouldQueue: false as const, newlyConfirmed: false, order };
    }
    if (order.status === 'ORDER_CONFIRMED' || order.confirmedAt) {
      return { shouldQueue: true as const, newlyConfirmed: false, order };
    }
    if (order.paymentStatus !== 'PAID' && order.paymentStatus !== 'COD_PENDING') {
      logger.warn('confirmOrderForFulfilment called on unpaid order', {
        orderId,
        paymentStatus: order.paymentStatus,
      });
      return { shouldQueue: false as const, newlyConfirmed: false, order };
    }
    if (!canTransition(order.status, 'ORDER_CONFIRMED')) {
      logger.warn('Fulfilment confirmation skipped for an incompatible order state', {
        orderId,
        status: order.status,
      });
      return { shouldQueue: false as const, newlyConfirmed: false, order };
    }

    const moved = await tx.order.updateMany({
      where: { id: orderId, status: order.status },
      data: { status: 'ORDER_CONFIRMED', confirmedAt: order.confirmedAt ?? new Date() },
    });
    if (moved.count !== 1) return { shouldQueue: false as const, newlyConfirmed: false, order };
    await tx.orderEvent.create({
      data: {
        orderId,
        type: 'STATUS_TRANSITION',
        fromStatus: order.status,
        toStatus: 'ORDER_CONFIRMED',
        message: 'Order confirmed - queuing supplier fulfilment',
        actorType,
        actorId: actorId ?? null,
      },
    });
    return { shouldQueue: true as const, newlyConfirmed: true, order };
  });

  if (!confirmation.shouldQueue) return false;
  await enqueueOrderFulfilment(orderId);
  if (!confirmation.newlyConfirmed || !confirmation.order) return false;

  const vars = await renderOrderEmailVars(orderId);
  await queueNotification({
    template: 'ORDER_CONFIRMATION',
    email: confirmation.order.userId ? vars.email : (confirmation.order.guestEmail ?? vars.email),
    userId: confirmation.order.userId,
    orderId,
    vars,
    skipIfNoEmail: true,
  });
  return true;
}

/** COD orders: confirm immediately after placement; money collected on delivery. */
export async function confirmCodOrder(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.paymentMethod !== 'COD') return;
  if (order.paymentStatus === 'PENDING') {
    await prisma.order.update({ where: { id: orderId }, data: { paymentStatus: 'COD_PENDING' } });
  }
  await confirmOrderForFulfilment(orderId, 'SYSTEM');
}

/** Admin action: record that COD cash was collected on delivery. */
export async function markCodCollected(orderId: string, actorId: string): Promise<void> {
  const changed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "orders" WHERE "id" = ${orderId} FOR UPDATE
    `;
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.paymentMethod !== 'COD') throw new Error('Order is not a COD order');
    if (order.paymentStatus === 'PAID') return false;
    if (order.cancelledAt || ['CANCELLED', 'REFUND_PENDING', 'REFUNDED'].includes(order.status)) {
      throw conflict('Cannot mark COD cash collected on a cancelled/refund-recovery order.');
    }
    await tx.order.update({
      where: { id: orderId },
      data: { paymentStatus: 'PAID', paidAt: new Date() },
    });
    await tx.orderEvent.create({
      data: {
        orderId,
        type: 'COD_COLLECTED',
        message: 'Cash on Delivery amount collected',
        actorType: 'ADMIN',
        actorId,
      },
    });
    await recalcOrderFinancials(orderId, tx);
    return true;
  });
  if (changed) {
    await auditLog({
      actor: { id: actorId },
      action: 'payment.cod_collected',
      entityType: 'Order',
      entityId: orderId,
    });
  }
}

async function upsertPaymentRow(
  tx: Prisma.TransactionClient,
  input: PaymentResultInput,
  orderId: string,
  status: 'PAID' | 'FAILED',
  fee?: { feePaise: number; feeIsEstimate: boolean },
  capturedAmountPaise?: number
) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  const data = {
    provider: input.provider,
    amount: dec(capturedAmountPaise ?? toPaise(order.grandTotal)),
    currency: order.currency,
    status,
    method: input.method ?? null,
    feeAmount: fee ? dec(fee.feePaise) : dec(0),
    feeIsEstimate: fee?.feeIsEstimate ?? true,
    providerPaymentId: input.providerPaymentId ?? null,
    failureReason: input.failureReason ?? null,
    signatureVerifiedAt:
      input.verifiedVia?.includes('signature') || input.verifiedVia === 'gateway-fetch+signature'
        ? new Date()
        : null,
    raw: (input.raw ? sanitizeForLog(input.raw) : Prisma.DbNull) as Prisma.InputJsonValue,
    ...(status === 'PAID' ? { paidAt: new Date() } : {}),
  };
  const existing = await tx.payment.findUnique({
    where: { providerOrderId: input.providerOrderId },
  });
  if (existing) {
    return tx.payment.update({ where: { id: existing.id }, data });
  }
  return tx.payment.create({
    data: { ...data, orderId, providerOrderId: input.providerOrderId },
  });
}
