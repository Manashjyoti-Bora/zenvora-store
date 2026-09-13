import { prisma } from '../db';
import { toPaise } from '../money';
import { logger } from '../logger';
import { auditLog } from '../audit';
import { getSettings } from '../settings';
import { estimatePaymentFeePaise } from '../checkout/calc';
import { transitionOrder, recordOrderEvent } from '../orders/state';
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
  'CONFIRMED' | 'DUPLICATE' | 'FAILED_RECORDED' | 'REJECTED_AMOUNT_MISMATCH' | 'ORDER_NOT_PAYABLE';

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

  if (['CANCELLED', 'REFUNDED', 'REFUND_PENDING'].includes(order.status)) {
    await recordOrderEvent({
      orderId: order.id,
      type: 'PAYMENT_IGNORED',
      message: `Payment result (${input.outcome}) ignored: order is ${order.status}`,
      actorType,
      data: { providerOrderId: input.providerOrderId },
    });
    return { outcome: 'ORDER_NOT_PAYABLE', orderNumber: order.orderNumber };
  }

  // --- FAILED outcome --------------------------------------------------------
  if (input.outcome === 'FAILED') {
    await upsertPaymentRow(input, order.id, 'FAILED');
    const anyPaid = order.payments.some((p) => p.status === 'PAID');
    if (!anyPaid && order.paymentStatus === 'PENDING') {
      await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: 'FAILED' } });
      await transitionOrder({
        orderId: order.id,
        to: 'PAYMENT_FAILED',
        actorType,
        expectedFrom: ['PENDING_PAYMENT'],
        message: input.failureReason ?? 'Payment failed',
        data: { providerOrderId: input.providerOrderId },
      });
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
    await recordOrderEvent({
      orderId: order.id,
      type: 'PAYMENT_FAILED',
      message: input.failureReason ?? 'Payment failed',
      actorType,
      data: { providerOrderId: input.providerOrderId, provider: input.provider },
    });
    return { outcome: 'FAILED_RECORDED', orderNumber: order.orderNumber };
  }

  // --- PAID outcome ----------------------------------------------------------
  if (input.amountPaise != null && input.amountPaise !== toPaise(order.grandTotal)) {
    // Payment manipulation protection: gateway amount must equal order total.
    logger.error('Payment amount mismatch - rejecting confirmation', {
      orderId: order.id,
      expected: toPaise(order.grandTotal),
      received: input.amountPaise,
    });
    await recordOrderEvent({
      orderId: order.id,
      type: 'PAYMENT_AMOUNT_MISMATCH',
      message: `Gateway amount ${input.amountPaise} paise != order total ${toPaise(order.grandTotal)} paise`,
      actorType,
      data: { providerOrderId: input.providerOrderId, received: input.amountPaise },
    });
    return { outcome: 'REJECTED_AMOUNT_MISMATCH', orderNumber: order.orderNumber };
  }

  const existingPaid = order.payments.find(
    (p) => p.providerOrderId === input.providerOrderId && p.status === 'PAID'
  );
  if (
    existingPaid &&
    order.paymentStatus === 'PAID' &&
    order.status !== 'PENDING_PAYMENT' &&
    order.status !== 'PAYMENT_FAILED'
  ) {
    // Fully processed already - duplicate webhook/verify call.
    logger.info('Duplicate payment confirmation ignored', { orderId: order.id });
    return { outcome: 'DUPLICATE', orderNumber: order.orderNumber };
  }

  const settings = await getSettings();
  const feeIsEstimate = input.feePaise == null;
  const feePaise =
    input.feePaise ??
    (order.paymentMethod === 'PREPAID_GATEWAY'
      ? estimatePaymentFeePaise(toPaise(order.grandTotal), settings)
      : 0);

  await upsertPaymentRow(input, order.id, 'PAID', { feePaise, feeIsEstimate });

  await prisma.order.update({
    where: { id: order.id },
    data: { paymentStatus: 'PAID', paidAt: order.paidAt ?? new Date() },
  });

  await transitionOrder({
    orderId: order.id,
    to: 'PAYMENT_VERIFIED',
    actorType,
    expectedFrom: ['PENDING_PAYMENT', 'PAYMENT_FAILED'],
    message: `Payment verified via ${input.verifiedVia ?? 'gateway'} (${input.provider}${input.providerPaymentId ? ` ${input.providerPaymentId}` : ''})`,
    data: { providerOrderId: input.providerOrderId },
  });

  await recordOrderEvent({
    orderId: order.id,
    type: 'PAYMENT_CAPTURED',
    message: `Captured ${dec(toPaise(order.grandTotal))} INR via ${input.provider}`,
    actorType,
    data: sanitizeForLog({
      providerPaymentId: input.providerPaymentId,
      method: input.method,
      feePaise,
      feeIsEstimate,
      raw: input.raw ?? undefined,
    }) as Prisma.InputJsonValue,
  });

  const confirmed = await confirmOrderForFulfilment(order.id, actorType);
  await recalcOrderFinancials(order.id);
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
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return false;
  if (order.status === 'ORDER_CONFIRMED' || order.confirmedAt) {
    // Already confirmed - ensure fulfilment is queued (self-healing) and stop.
    await enqueueOrderFulfilment(orderId);
    return false;
  }
  if (order.paymentStatus !== 'PAID' && order.paymentStatus !== 'COD_PENDING') {
    logger.warn('confirmOrderForFulfilment called on unpaid order', {
      orderId,
      paymentStatus: order.paymentStatus,
    });
    return false;
  }

  await transitionOrder({
    orderId,
    to: 'ORDER_CONFIRMED',
    actorType,
    actorId,
    expectedFrom: ['PAYMENT_VERIFIED', 'PENDING_PAYMENT'],
    set: { confirmedAt: new Date() },
    message: 'Order confirmed - queuing supplier fulfilment',
  });

  await enqueueOrderFulfilment(orderId);

  const vars = await renderOrderEmailVars(orderId);
  await queueNotification({
    template: 'ORDER_CONFIRMATION',
    email: order.userId ? vars.email : (order.guestEmail ?? vars.email),
    userId: order.userId,
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
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.paymentMethod !== 'COD') throw new Error('Order is not a COD order');
  if (order.paymentStatus === 'PAID') return;
  await prisma.order.update({
    where: { id: orderId },
    data: { paymentStatus: 'PAID', paidAt: new Date() },
  });
  await recordOrderEvent({
    orderId,
    type: 'COD_COLLECTED',
    message: 'Cash on Delivery amount collected',
    actorType: 'ADMIN',
    actorId,
  });
  await recalcOrderFinancials(orderId);
}

async function upsertPaymentRow(
  input: PaymentResultInput,
  orderId: string,
  status: 'PAID' | 'FAILED',
  fee?: { feePaise: number; feeIsEstimate: boolean }
): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const data = {
    provider: input.provider,
    amount: dec(toPaise(order.grandTotal)),
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
  const existing = await prisma.payment.findUnique({
    where: { providerOrderId: input.providerOrderId },
  });
  if (existing) {
    await prisma.payment.update({ where: { id: existing.id }, data });
  } else {
    await prisma.payment.create({
      data: { ...data, orderId, providerOrderId: input.providerOrderId },
    });
  }
}
