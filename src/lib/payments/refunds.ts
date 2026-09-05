import { prisma } from '../db';
import { badRequest, notFound } from '../errors';
import { toPaise } from '../money';
import { logger } from '../logger';
import { auditLog } from '../audit';
import { transitionOrder, recordOrderEvent, canTransition } from '../orders/state';
import { recalcOrderFinancials } from '../orders/finance';
import { queueNotification } from '../notifications/notify';
import { renderOrderEmailVars } from '../notifications/order-vars';
import { formatINR } from '../money';
import { getPaymentProvider } from './index';
import type { OrderActorType } from '@prisma/client';

/**
 * Refund service.
 *
 * - Full and partial refunds are supported (Razorpay supports partial refunds
 *   natively).
 * - When the gateway is reachable, the refund is initiated through it and
 *   completes via webhook (status PROCESSING -> COMPLETED).
 * - When gateway credentials are missing (or the payment was COD/TEST), an
 *   honest REQUESTED record is created for manual processing by the admin -
 *   the system never pretends a refund happened.
 * - Money invariants: sum(refunds) can never exceed sum(paid payments);
 *   enforced before creation.
 */

const dec = (paise: number) => (paise / 100).toFixed(2);

export interface CreateRefundInput {
  orderId: string;
  amountPaise: number;
  reason: string;
  returnRequestId?: string | null;
  actor?: OrderActorType;
  actorId?: string | null;
}

export async function createRefund(
  input: CreateRefundInput
): Promise<{ refundId: string; status: string }> {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw badRequest('Refund amount must be a positive value.');
  }

  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: { payments: true, refunds: true },
  });
  if (!order) throw notFound('Order not found');

  const paidTotal = order.payments
    .filter((p) => ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(p.status))
    .reduce((a, p) => a + toPaise(p.amount), 0);
  const alreadyRefunded = order.refunds
    .filter((r) => r.status !== 'FAILED')
    .reduce((a, r) => a + toPaise(r.amount), 0);
  const refundable = paidTotal - alreadyRefunded;

  if (paidTotal <= 0) {
    throw badRequest('This order has no captured payment to refund.');
  }
  if (input.amountPaise > refundable) {
    throw badRequest(
      `Refund exceeds refundable balance (${formatINR(refundable)} available of ${formatINR(paidTotal)} paid).`
    );
  }

  const payment = order.payments
    .filter((p) => p.status === 'PAID' || p.status === 'PARTIALLY_REFUNDED')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  const actor = input.actor ?? 'ADMIN';
  let status: 'REQUESTED' | 'PROCESSING' | 'COMPLETED' = 'REQUESTED';
  let providerRefundId: string | null = null;
  let failureReason: string | null = null;

  if (payment && payment.provider === 'RAZORPAY' && payment.providerPaymentId) {
    const provider = getPaymentProvider();
    if (provider && provider.kind === 'RAZORPAY' && provider.isConfigured()) {
      try {
        const result = await provider.refund({
          providerPaymentId: payment.providerPaymentId,
          amountPaise: input.amountPaise,
          reason: input.reason,
        });
        providerRefundId = result.providerRefundId;
        status = result.status === 'COMPLETED' ? 'COMPLETED' : 'PROCESSING';
      } catch (err) {
        failureReason = `Gateway refund failed: ${err instanceof Error ? err.message : String(err)}. Process manually, then update status.`;
        logger.error('Gateway refund call failed', { orderId: order.id, error: failureReason });
      }
    } else {
      failureReason =
        'Razorpay credentials not configured on this server. Process the refund in the Razorpay dashboard, then mark it completed here.';
    }
  } else if (payment && payment.provider === 'TEST' && payment.providerPaymentId) {
    const provider = getPaymentProvider();
    if (provider && provider.kind === 'TEST') {
      const result = await provider.refund({
        providerPaymentId: payment.providerPaymentId,
        amountPaise: input.amountPaise,
      });
      providerRefundId = result.providerRefundId;
      status = 'COMPLETED'; // TEST provider completes instantly
    } else {
      failureReason =
        'TEST provider disabled in this environment; refund recorded for manual processing.';
    }
  } else if (!payment || order.paymentMethod === 'COD') {
    failureReason = payment
      ? 'No gateway payment id available; refund must be processed manually (e.g. bank transfer).'
      : 'COD order: no online payment to refund. If money was collected, refund it manually and mark completed.';
  }

  const refund = await prisma.refund.create({
    data: {
      orderId: order.id,
      paymentId: payment?.id ?? null,
      returnRequestId: input.returnRequestId ?? null,
      amount: dec(input.amountPaise),
      status,
      provider: payment?.provider ?? null,
      providerRefundId,
      reason: input.reason,
      failureReason,
      initiatedBy: actor,
      ...(status === 'COMPLETED' ? { processedAt: new Date() } : {}),
    },
  });

  await applyRefundToLedger(order.id, refund.id);

  await recordOrderEvent({
    orderId: order.id,
    type: status === 'COMPLETED' ? 'REFUND_COMPLETED' : 'REFUND_INITIATED',
    message: `Refund ${formatINR(input.amountPaise)} - ${status}${failureReason ? ` (${failureReason})` : ''}`,
    actorType: actor,
    actorId: input.actorId ?? null,
    data: { refundId: refund.id, reason: input.reason },
  });
  await auditLog({
    actor: input.actorId ? { id: input.actorId } : null,
    action: 'refund.created',
    entityType: 'Refund',
    entityId: refund.id,
    data: { orderId: order.id, amountPaise: input.amountPaise, status },
  });

  const vars = await renderOrderEmailVars(order.id);
  const customerEmail = order.guestEmail ?? vars.email;
  await queueNotification({
    template: 'REFUND_INITIATED',
    email: customerEmail,
    userId: order.userId,
    orderId: order.id,
    vars: { ...vars, refundAmount: formatINR(input.amountPaise) },
    skipIfNoEmail: true,
  });

  return { refundId: refund.id, status };
}

/**
 * Called when the gateway confirms a refund (webhook) or an admin marks a
 * manual refund completed.
 */
export async function settleRefund(params: {
  refundId?: string;
  providerRefundId?: string;
  status: 'COMPLETED' | 'FAILED';
  failureReason?: string;
  actor?: OrderActorType;
  actorId?: string | null;
}): Promise<void> {
  const refund = params.refundId
    ? await prisma.refund.findUnique({ where: { id: params.refundId } })
    : params.providerRefundId
      ? await prisma.refund.findFirst({ where: { providerRefundId: params.providerRefundId } })
      : null;
  if (!refund) {
    logger.warn('settleRefund: refund record not found', { params });
    return;
  }
  if (refund.status === params.status) return; // idempotent

  await prisma.refund.update({
    where: { id: refund.id },
    data: {
      status: params.status,
      failureReason: params.failureReason ?? refund.failureReason,
      ...(params.status === 'COMPLETED' ? { processedAt: new Date() } : {}),
    },
  });

  await applyRefundToLedger(refund.orderId, refund.id);

  const order = await prisma.order.findUniqueOrThrow({ where: { id: refund.orderId } });
  await recordOrderEvent({
    orderId: order.id,
    type: params.status === 'COMPLETED' ? 'REFUND_COMPLETED' : 'REFUND_FAILED',
    message:
      params.status === 'COMPLETED'
        ? `Refund of ${formatINR(toPaise(refund.amount))} completed`
        : `Refund failed: ${params.failureReason ?? 'unknown reason'}`,
    actorType: params.actor ?? 'PAYMENT_PROVIDER',
    actorId: params.actorId ?? null,
  });

  if (params.status === 'COMPLETED') {
    const fullyRefunded = await isFullyRefunded(order.id);
    if (fullyRefunded) {
      await transitionOrder({
        orderId: order.id,
        to: 'REFUNDED',
        actorType: params.actor ?? 'PAYMENT_PROVIDER',
        message: 'Order fully refunded',
      });
    } else if (order.status === 'REFUND_PENDING') {
      // Partial refund done: try to restore the pre-refund fulfilment status.
      const restore = ['DELIVERED', 'SHIPPED', 'PROCESSING', 'ORDER_CONFIRMED'] as const;
      const target = restore.find((s) => canTransition(order.status, s));
      if (target) {
        await transitionOrder({
          orderId: order.id,
          to: target,
          actorType: params.actor ?? 'PAYMENT_PROVIDER',
          message: 'Partial refund completed - order restored to fulfilment status',
        });
      }
    }
    const vars = await renderOrderEmailVars(order.id);
    await queueNotification({
      template: 'REFUND_COMPLETED',
      email: order.guestEmail ?? vars.email,
      userId: order.userId,
      orderId: order.id,
      vars: { ...vars, refundAmount: formatINR(toPaise(refund.amount)) },
      skipIfNoEmail: true,
    });
  }
}

async function applyRefundToLedger(orderId: string, refundId: string): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { payments: true, refunds: true },
  });
  const refund = order.refunds.find((r) => r.id === refundId);
  if (!refund) return;

  const refundedTotal = order.refunds
    .filter((r) => ['PROCESSING', 'COMPLETED'].includes(r.status))
    .reduce((a, r) => a + toPaise(r.amount), 0);
  const paidTotal = order.payments
    .filter((p) => ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(p.status))
    .reduce((a, p) => a + toPaise(p.amount), 0);

  if (refund.paymentId) {
    const payment = order.payments.find((p) => p.id === refund.paymentId);
    if (payment) {
      const paymentRefunded = order.refunds
        .filter((r) => r.paymentId === payment.id && ['PROCESSING', 'COMPLETED'].includes(r.status))
        .reduce((a, r) => a + toPaise(r.amount), 0);
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          refundedTotal: dec(paymentRefunded),
          status:
            paymentRefunded >= toPaise(payment.amount)
              ? 'REFUNDED'
              : paymentRefunded > 0
                ? 'PARTIALLY_REFUNDED'
                : 'PAID',
        },
      });
    }
  }

  await prisma.order.update({
    where: { id: orderId },
    data: {
      refundedTotal: dec(refundedTotal),
      paymentStatus:
        refundedTotal >= paidTotal && paidTotal > 0
          ? 'REFUNDED'
          : refundedTotal > 0
            ? 'PARTIALLY_REFUNDED'
            : order.paymentStatus,
    },
  });

  if (refundedTotal > 0 && refundedTotal < paidTotal && order.status !== 'REFUND_PENDING') {
    if (canTransition(order.status, 'REFUND_PENDING')) {
      await transitionOrder({
        orderId,
        to: 'REFUND_PENDING',
        message: 'Refund in progress (partial)',
        actorType: 'SYSTEM',
      });
    }
  }
  if (refundedTotal >= paidTotal && paidTotal > 0 && order.status !== 'REFUNDED') {
    if (canTransition(order.status, 'REFUND_PENDING')) {
      await transitionOrder({
        orderId,
        to: 'REFUND_PENDING',
        message: 'Full refund initiated',
        actorType: 'SYSTEM',
      });
    }
    await transitionOrder({
      orderId,
      to: 'REFUNDED',
      message: 'Order fully refunded',
      actorType: 'SYSTEM',
    });
  }

  await recalcOrderFinancials(orderId);
}

async function isFullyRefunded(orderId: string): Promise<boolean> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { payments: true, refunds: true },
  });
  const paidTotal = order.payments
    .filter((p) => ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(p.status))
    .reduce((a, p) => a + toPaise(p.amount), 0);
  const refundedTotal = order.refunds
    .filter((r) => ['PROCESSING', 'COMPLETED'].includes(r.status))
    .reduce((a, r) => a + toPaise(r.amount), 0);
  return paidTotal > 0 && refundedTotal >= paidTotal;
}
