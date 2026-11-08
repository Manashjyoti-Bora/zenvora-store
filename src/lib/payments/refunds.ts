import { createHash } from 'node:crypto';
import { prisma } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import { formatINR, toPaise } from '../money';
import { logger } from '../logger';
import { auditLog } from '../audit';
import { canTransition } from '../orders/state';
import { recalcOrderFinancials } from '../orders/finance';
import { queueNotification } from '../notifications/notify';
import { renderOrderEmailVars } from '../notifications/order-vars';
import { getPaymentProvider } from './index';
import {
  isRefundFullySettled,
  paymentRefundStatus,
  reservedRefundTotalPaise,
  settledRefundTotalPaise,
} from './refund-accounting';
import type { OrderActorType, Prisma } from '@prisma/client';

const dec = (paise: number) => (paise / 100).toFixed(2);
type Tx = Prisma.TransactionClient;

export interface CreateRefundInput {
  orderId: string;
  amountPaise: number;
  reason: string;
  returnRequestId?: string | null;
  actor?: OrderActorType;
  actorId?: string | null;
  /** Stable across retries of one admin operation. */
  idempotencyKey?: string | null;
}

export interface RefundReservation {
  refundId: string;
  orderId: string;
  paymentId: string | null;
  providerPaymentId: string | null;
  provider: 'RAZORPAY' | 'TEST' | null;
  amountPaise: number;
  status: 'REQUESTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  existing: boolean;
}

/**
 * Persist a refund obligation before calling a provider. The order row lock
 * serializes balance checks across independent database connections. REQUESTED
 * and PROCESSING reserve capacity; only COMPLETED counts as money returned.
 */
export async function reserveRefund(tx: Tx, input: CreateRefundInput): Promise<RefundReservation> {
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw badRequest('Refund amount must be a positive whole number of paise.');
  }
  const idempotencyKey = input.idempotencyKey?.trim() || null;
  if (idempotencyKey && idempotencyKey.length > 200) {
    throw badRequest('Refund idempotency key must not exceed 200 characters.');
  }
  const reservationId = idempotencyKey
    ? keyedRefundReservationId(input.orderId, idempotencyKey)
    : null;

  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "orders" WHERE "id" = ${input.orderId} FOR UPDATE
  `;
  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    include: { payments: true, refunds: true },
  });
  if (!order) throw notFound('Order not found');

  const existingReservation = (prior: (typeof order.refunds)[number]): RefundReservation => {
    if (
      toPaise(prior.amount) !== input.amountPaise ||
      (prior.returnRequestId ?? null) !== (input.returnRequestId ?? null)
    ) {
      throw conflict('The refund idempotency key was already used for a different request.');
    }
    const payment = order.payments.find((candidate) => candidate.id === prior.paymentId);
    return {
      refundId: prior.id,
      orderId: order.id,
      paymentId: prior.paymentId,
      providerPaymentId: payment?.providerPaymentId ?? null,
      provider: prior.provider,
      amountPaise: toPaise(prior.amount),
      status: prior.status,
      existing: true,
    };
  };

  if (reservationId) {
    const prior = order.refunds.find((refund) => refund.id === reservationId);
    if (prior) return existingReservation(prior);
  }
  if (input.returnRequestId) {
    // A return has one durable refund reservation, including unresolved FAILED
    // outcomes that may later be confirmed completed by the provider.
    const prior = order.refunds.find((refund) => refund.returnRequestId === input.returnRequestId);
    if (prior) return existingReservation(prior);
  }

  const paidPayments = order.payments.filter((payment) =>
    ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(payment.status)
  );
  const paidTotalPaise = paidPayments.reduce((sum, payment) => sum + toPaise(payment.amount), 0);
  // COD has no gateway Payment row. The order records collection only after
  // the admin marks cash received; before that there is no refundable amount.
  const codCollectedPaise =
    order.paymentMethod === 'COD' &&
    ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(order.paymentStatus)
      ? toPaise(order.grandTotal)
      : 0;
  const refundableTotalPaise = paidTotalPaise + codCollectedPaise;
  const reservedTotalPaise = reservedRefundTotalPaise(
    order.refunds.map((refund) => ({ amountPaise: toPaise(refund.amount), status: refund.status }))
  );
  const availablePaise = Math.max(0, refundableTotalPaise - reservedTotalPaise);
  if (refundableTotalPaise <= 0) {
    throw badRequest('This order has no verified captured payment or collected COD to refund.');
  }
  if (input.amountPaise > availablePaise) {
    throw badRequest(
      `Refund exceeds refundable balance (${formatINR(availablePaise)} available of ${formatINR(refundableTotalPaise)} paid).`
    );
  }

  let payment: (typeof paidPayments)[number] | null = null;
  if (paidPayments.length > 0) {
    payment =
      paidPayments
        .map((candidate) => {
          const paymentRefunds = order.refunds
            .filter((refund) => refund.paymentId === candidate.id)
            .map((refund) => ({ amountPaise: toPaise(refund.amount), status: refund.status }));
          return {
            candidate,
            available: toPaise(candidate.amount) - reservedRefundTotalPaise(paymentRefunds),
          };
        })
        .filter((candidate) => candidate.available >= input.amountPaise)
        .sort((a, b) => b.candidate.createdAt.getTime() - a.candidate.createdAt.getTime())[0]
        ?.candidate ?? null;
    if (!payment) {
      throw badRequest(
        'The refundable balance is split across payments; this refund must be reviewed manually.'
      );
    }
  }

  const actor = input.actor ?? 'ADMIN';
  const refund = await tx.refund.create({
    data: {
      id: reservationId ?? undefined,
      orderId: order.id,
      paymentId: payment?.id ?? null,
      returnRequestId: input.returnRequestId ?? null,
      amount: dec(input.amountPaise),
      status: 'REQUESTED',
      provider: payment?.provider ?? null,
      reason: input.reason,
      initiatedBy: actor,
    },
  });

  if (order.status !== 'REFUND_PENDING' && canTransition(order.status, 'REFUND_PENDING')) {
    const changed = await tx.order.updateMany({
      where: { id: order.id, status: order.status },
      data: { status: 'REFUND_PENDING' },
    });
    if (changed.count !== 1)
      throw conflict('Order changed while reserving the refund; retry the operation.');
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: 'STATUS_TRANSITION',
        fromStatus: order.status,
        toStatus: 'REFUND_PENDING',
        message: 'Refund reserved; provider settlement is not yet confirmed',
        actorType: actor,
        actorId: input.actorId ?? null,
        data: { refundId: refund.id, amountPaise: input.amountPaise },
      },
    });
  }

  await tx.orderEvent.create({
    data: {
      orderId: order.id,
      type: 'REFUND_INITIATED',
      message: `Refund ${formatINR(input.amountPaise)} reserved; settlement pending`,
      actorType: actor,
      actorId: input.actorId ?? null,
      data: { refundId: refund.id, reason: input.reason },
    },
  });

  return {
    refundId: refund.id,
    orderId: order.id,
    paymentId: payment?.id ?? null,
    providerPaymentId: payment?.providerPaymentId ?? null,
    provider: payment?.provider ?? null,
    amountPaise: input.amountPaise,
    status: 'REQUESTED',
    existing: false,
  };
}

/** Reserve first, then perform any provider request outside the DB transaction. */
export async function createRefund(
  input: CreateRefundInput
): Promise<{ refundId: string; status: string; duplicate: boolean }> {
  const reservation = await prisma.$transaction((tx) => reserveRefund(tx, input), {
    isolationLevel: 'Serializable',
  });
  const result = await processRefundReservation(reservation, input.reason);
  if (!reservation.existing) {
    await auditLog({
      actor: input.actorId ? { id: input.actorId } : null,
      action: 'refund.created',
      entityType: 'Refund',
      entityId: reservation.refundId,
      data: {
        orderId: reservation.orderId,
        amountPaise: reservation.amountPaise,
        status: result.status,
      },
    });
  }
  return { ...result, duplicate: reservation.existing };
}

function keyedRefundReservationId(orderId: string, idempotencyKey: string): string {
  return `refund_${createHash('sha256').update(`${orderId}\0${idempotencyKey}`).digest('hex').slice(0, 48)}`;
}

/**
 * Provider calls are never inside a DB transaction. If the call times out, its
 * outcome is ambiguous: keep PROCESSING (the balance remains reserved) and
 * require reconciliation instead of blindly retrying a potentially successful
 * refund. REQUESTED records without an eligible configured provider stay manual.
 */
export async function processRefundReservation(
  reservation: RefundReservation,
  reason?: string
): Promise<{ refundId: string; status: string }> {
  const current = await prisma.refund.findUnique({ where: { id: reservation.refundId } });
  if (!current) throw notFound('Refund reservation not found');
  if (current.status === 'COMPLETED' || current.status === 'FAILED') {
    return { refundId: current.id, status: current.status };
  }
  if (!reservation.providerPaymentId || !reservation.provider) {
    return { refundId: current.id, status: current.status };
  }
  // A REQUESTED reservation is provably not yet submitted: claiming it as
  // PROCESSING is committed before the provider call. This allows recovery if
  // the process stopped after reservation persistence but before submission.
  // PROCESSING reservations are never retried here because the provider outcome
  // may be ambiguous.

  const provider = getPaymentProvider();
  if (!provider || provider.kind !== reservation.provider || !provider.isConfigured()) {
    const updated = await prisma.refund.updateMany({
      where: { id: current.id, status: 'REQUESTED' },
      data: {
        failureReason: 'No matching configured provider; administrator processing is required.',
      },
    });
    if (updated.count === 1) return { refundId: current.id, status: 'REQUESTED' };
    const latest = await prisma.refund.findUniqueOrThrow({ where: { id: current.id } });
    return { refundId: latest.id, status: latest.status };
  }

  const claimed = await prisma.refund.updateMany({
    where: { id: current.id, status: 'REQUESTED' },
    data: { status: 'PROCESSING', failureReason: null },
  });
  if (claimed.count === 0) {
    const latest = await prisma.refund.findUniqueOrThrow({ where: { id: current.id } });
    return { refundId: latest.id, status: latest.status };
  }

  try {
    const result = await provider.refund({
      providerPaymentId: reservation.providerPaymentId,
      amountPaise: reservation.amountPaise,
      reason,
      refundId: current.id,
    });
    if (result.providerRefundId) {
      await prisma.refund.updateMany({
        where: { id: current.id, status: 'PROCESSING' },
        data: { providerRefundId: result.providerRefundId },
      });
    }
    if (result.status === 'COMPLETED' || result.status === 'FAILED') {
      await settleRefund({
        refundId: current.id,
        status: result.status,
        failureReason: result.failureReason,
        actor: 'PAYMENT_PROVIDER',
      });
    } else if (!result.providerRefundId) {
      await prisma.refund.updateMany({
        where: { id: current.id, status: 'PROCESSING' },
        data: {
          failureReason: 'Provider returned no refund reference; reconciliation is required.',
        },
      });
    }
  } catch (error) {
    const errorName = error instanceof Error ? error.name.slice(0, 80) : 'UnknownError';
    await prisma.refund.updateMany({
      where: { id: current.id, status: 'PROCESSING' },
      data: {
        failureReason:
          'Provider call returned an unknown outcome; verify provider status before any retry.',
      },
    });
    logger.error('Refund provider result is ambiguous; reservation retained for reconciliation', {
      refundId: current.id,
      orderId: reservation.orderId,
      errorName,
    });
  }

  const final = await prisma.refund.findUniqueOrThrow({ where: { id: current.id } });
  if (final.status === 'REQUESTED' || final.status === 'PROCESSING') {
    const vars = await renderOrderEmailVars(reservation.orderId);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: reservation.orderId } });
    await queueNotification({
      template: 'REFUND_INITIATED',
      email: order.guestEmail ?? vars.email,
      userId: order.userId,
      orderId: order.id,
      vars: { ...vars, refundAmount: formatINR(reservation.amountPaise) },
      skipIfNoEmail: true,
    });
  }
  return { refundId: final.id, status: final.status };
}

/** Provider settlement or an administrator-confirmed manual settlement. */
export async function settleRefund(params: {
  refundId?: string;
  providerRefundId?: string;
  status: 'COMPLETED' | 'FAILED';
  failureReason?: string;
  actor?: OrderActorType;
  actorId?: string | null;
}): Promise<boolean> {
  const changed = await prisma.$transaction(async (tx) => {
    const candidate = params.refundId
      ? await tx.refund.findUnique({ where: { id: params.refundId } })
      : params.providerRefundId
        ? await tx.refund.findFirst({ where: { providerRefundId: params.providerRefundId } })
        : null;
    if (!candidate) {
      logger.warn('settleRefund: refund record not found', {
        refundId: params.refundId,
        providerRefundId: params.providerRefundId,
      });
      return null;
    }

    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "orders" WHERE "id" = ${candidate.orderId} FOR UPDATE
    `;
    const refund = await tx.refund.findUnique({ where: { id: candidate.id } });
    if (!refund) return null;
    if (
      params.providerRefundId &&
      refund.providerRefundId &&
      refund.providerRefundId !== params.providerRefundId
    ) {
      throw conflict('Refund provider id does not match the existing reservation.');
    }
    // COMPLETED is terminal. FAILED remains an unresolved reservation because
    // a verified later completion may arrive out of order.
    if (refund.status === 'COMPLETED' && params.status !== 'COMPLETED') return null;
    if (refund.status === params.status) {
      // Repair a provider-id persistence gap without duplicating ledger events.
      if (params.providerRefundId && refund.providerRefundId !== params.providerRefundId) {
        await tx.refund.update({
          where: { id: refund.id },
          data: { providerRefundId: params.providerRefundId },
        });
      }
      return null;
    }

    const update = await tx.refund.updateMany({
      where: { id: refund.id, status: refund.status },
      data: {
        status: params.status,
        providerRefundId: params.providerRefundId ?? refund.providerRefundId,
        failureReason:
          params.status === 'FAILED' ? (params.failureReason ?? refund.failureReason) : null,
        ...(params.status === 'COMPLETED'
          ? { processedAt: refund.processedAt ?? new Date() }
          : {}),
      },
    });
    if (update.count !== 1) return null;

    await tx.orderEvent.create({
      data: {
        orderId: refund.orderId,
        type: params.status === 'COMPLETED' ? 'REFUND_COMPLETED' : 'REFUND_FAILED',
        message:
          params.status === 'COMPLETED'
            ? `Refund of ${formatINR(toPaise(refund.amount))} confirmed completed`
            : `Refund failed: ${params.failureReason ?? 'provider confirmed failure'}`,
        actorType: params.actor ?? 'PAYMENT_PROVIDER',
        actorId: params.actorId ?? null,
        data: {
          refundId: refund.id,
          providerRefundId: params.providerRefundId ?? refund.providerRefundId,
        },
      },
    });

    await applyRefundLedgerInTransaction(tx, refund.orderId);
    if (refund.returnRequestId && params.status === 'COMPLETED') {
      const returnRefunds = await tx.refund.findMany({
        where: { returnRequestId: refund.returnRequestId },
      });
      if (returnRefunds.length > 0 && returnRefunds.every((item) => item.status === 'COMPLETED')) {
        await tx.returnRequest.updateMany({
          where: { id: refund.returnRequestId },
          data: { status: 'REFUNDED', resolvedAt: new Date() },
        });
      }
    }
    await recalcOrderFinancials(refund.orderId, tx);
    return refund;
  });

  if (!changed) return false;

  await auditLog({
    actor: params.actorId ? { id: params.actorId } : null,
    action: params.status === 'COMPLETED' ? 'refund.completed' : 'refund.failed',
    entityType: 'Refund',
    entityId: changed.id,
    data: { orderId: changed.orderId, amountPaise: toPaise(changed.amount), status: params.status },
  });

  if (params.status === 'COMPLETED') {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: changed.orderId } });
    const vars = await renderOrderEmailVars(order.id);
    await queueNotification({
      template: 'REFUND_COMPLETED',
      email: order.guestEmail ?? vars.email,
      userId: order.userId,
      orderId: order.id,
      vars: { ...vars, refundAmount: formatINR(toPaise(changed.amount)) },
      skipIfNoEmail: true,
      dedupeExtra: changed.id,
    });
  }
  return true;
}

async function applyRefundLedgerInTransaction(tx: Tx, orderId: string): Promise<void> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { payments: true, refunds: true },
  });
  const settledTotal = settledRefundTotalPaise(
    order.refunds.map((refund) => ({ amountPaise: toPaise(refund.amount), status: refund.status }))
  );
  const paidPayments = order.payments.filter((payment) =>
    ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(payment.status)
  );
  const paidTotal = paidPayments.reduce((sum, payment) => sum + toPaise(payment.amount), 0);
  const codCollected =
    order.paymentMethod === 'COD' &&
    ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(order.paymentStatus);
  const totalRefundable = paidTotal + (codCollected ? toPaise(order.grandTotal) : 0);

  for (const payment of paidPayments) {
    const paymentSettled = settledRefundTotalPaise(
      order.refunds
        .filter((refund) => refund.paymentId === payment.id)
        .map((refund) => ({ amountPaise: toPaise(refund.amount), status: refund.status }))
    );
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        refundedTotal: dec(paymentSettled),
        status: paymentRefundStatus(toPaise(payment.amount), paymentSettled),
      },
    });
  }

  const currentOrder = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  const hasUnsettledObligation = order.refunds.some((refund) => refund.status !== 'COMPLETED');
  const fullSettlement = isRefundFullySettled(totalRefundable, settledTotal);
  const nextPaymentStatus = fullSettlement
    ? 'REFUNDED'
    : settledTotal > 0
      ? 'PARTIALLY_REFUNDED'
      : currentOrder.paymentStatus;

  let nextStatus = currentOrder.status;
  if (
    fullSettlement &&
    currentOrder.status !== 'REFUNDED' &&
    canTransition(currentOrder.status, 'REFUNDED')
  ) {
    nextStatus = 'REFUNDED';
  } else if (
    hasUnsettledObligation &&
    currentOrder.status !== 'REFUND_PENDING' &&
    canTransition(currentOrder.status, 'REFUND_PENDING')
  ) {
    nextStatus = 'REFUND_PENDING';
  } else if (
    !hasUnsettledObligation &&
    settledTotal > 0 &&
    currentOrder.status === 'REFUND_PENDING'
  ) {
    const candidates = currentOrder.cancelledAt
      ? (['CANCELLED'] as const)
      : (['DELIVERED', 'SHIPPED', 'PROCESSING', 'ORDER_CONFIRMED'] as const);
    nextStatus =
      candidates.find((candidate) => canTransition(currentOrder.status, candidate)) ??
      currentOrder.status;
  }

  if (nextStatus !== currentOrder.status) {
    const updated = await tx.order.updateMany({
      where: { id: orderId, status: currentOrder.status },
      data: { status: nextStatus, paymentStatus: nextPaymentStatus },
    });
    if (updated.count !== 1)
      throw conflict('Order changed while updating refund ledger; retry settlement.');
    await tx.orderEvent.create({
      data: {
        orderId,
        type: 'STATUS_TRANSITION',
        fromStatus: currentOrder.status,
        toStatus: nextStatus,
        message:
          nextStatus === 'REFUNDED'
            ? 'All captured funds are confirmed refunded'
            : nextStatus === 'REFUND_PENDING'
              ? 'Refund obligation remains unresolved'
              : 'Partial refund settled; order state restored',
        actorType: 'SYSTEM',
      },
    });
  } else if (currentOrder.paymentStatus !== nextPaymentStatus) {
    await tx.order.update({ where: { id: orderId }, data: { paymentStatus: nextPaymentStatus } });
  }
}
