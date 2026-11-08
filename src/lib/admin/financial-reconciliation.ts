import { prisma } from '../db';
import { toPaise } from '../money';
import { isRefundFullySettled, paymentRefundStatus } from '../payments/refund-accounting';
import type { Prisma } from '@prisma/client';

export interface ReconciliationPayment {
  id: string;
  status: string;
  amountPaise: number;
  refundedTotalPaise: number;
}

export interface ReconciliationRefund {
  id: string;
  paymentId: string | null;
  amountPaise: number;
  status: string;
  providerRefundId: string | null;
  createdAt: Date;
}

export interface FinancialSnapshot {
  orderId: string;
  orderStatus: string;
  paymentMethod: string;
  paymentStatus: string;
  grandTotalPaise: number;
  refundedTotalPaise: number;
  payments: ReconciliationPayment[];
  refunds: ReconciliationRefund[];
}

export interface ReconciliationFinding {
  orderId: string;
  code:
    | 'ORDER_REFUNDED_TOTAL_MISMATCH'
    | 'PAYMENT_REFUNDED_TOTAL_MISMATCH'
    | 'PAYMENT_REFUND_STATUS_MISMATCH'
    | 'ORDER_PAYMENT_STATUS_MISMATCH'
    | 'ORDER_MARKED_REFUNDED_BEFORE_SETTLEMENT'
    | 'CANCELLED_CAPTURE_WITHOUT_REFUND'
    | 'STALE_REFUND_RESERVATION'
    | 'FAILED_REFUND_REVIEW';
  recordId?: string;
  expectedPaise?: number;
  actualPaise?: number;
}

const capturedStatuses = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'];

/** Pure, read-only comparison of stored aggregates to authoritative refund rows. */
export function reconcileFinancialSnapshot(
  snapshot: FinancialSnapshot,
  now = new Date(),
  staleAfterMs = 30 * 60_000
): ReconciliationFinding[] {
  const findings: ReconciliationFinding[] = [];
  const completedRefunds = snapshot.refunds.filter((refund) => refund.status === 'COMPLETED');
  const completedTotal = completedRefunds.reduce((sum, refund) => sum + refund.amountPaise, 0);
  if (snapshot.refundedTotalPaise !== completedTotal) {
    findings.push({
      orderId: snapshot.orderId,
      code: 'ORDER_REFUNDED_TOTAL_MISMATCH',
      expectedPaise: completedTotal,
      actualPaise: snapshot.refundedTotalPaise,
    });
  }

  let paidTotal = 0;
  for (const payment of snapshot.payments) {
    if (!capturedStatuses.includes(payment.status)) continue;
    paidTotal += payment.amountPaise;
    const paymentRefunds = completedRefunds
      .filter((refund) => refund.paymentId === payment.id)
      .reduce((sum, refund) => sum + refund.amountPaise, 0);
    if (payment.refundedTotalPaise !== paymentRefunds) {
      findings.push({
        orderId: snapshot.orderId,
        code: 'PAYMENT_REFUNDED_TOTAL_MISMATCH',
        recordId: payment.id,
        expectedPaise: paymentRefunds,
        actualPaise: payment.refundedTotalPaise,
      });
    }
    const expectedStatus = paymentRefundStatus(payment.amountPaise, paymentRefunds);
    if (payment.status !== expectedStatus) {
      findings.push({
        orderId: snapshot.orderId,
        code: 'PAYMENT_REFUND_STATUS_MISMATCH',
        recordId: payment.id,
      });
    }
  }

  const codCollected =
    snapshot.paymentMethod === 'COD' &&
    ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(snapshot.paymentStatus);
  if (codCollected) paidTotal += snapshot.grandTotalPaise;
  const hasCapturedPayment = paidTotal > 0;
  if (hasCapturedPayment) {
    const expectedStatus = paymentRefundStatus(paidTotal, completedTotal);
    if (snapshot.paymentStatus !== expectedStatus) {
      findings.push({ orderId: snapshot.orderId, code: 'ORDER_PAYMENT_STATUS_MISMATCH' });
    }
    if (snapshot.orderStatus === 'REFUNDED' && !isRefundFullySettled(paidTotal, completedTotal)) {
      findings.push({ orderId: snapshot.orderId, code: 'ORDER_MARKED_REFUNDED_BEFORE_SETTLEMENT' });
    }
    const refundCoverage = snapshot.refunds.reduce((sum, refund) => sum + refund.amountPaise, 0);
    if (snapshot.orderStatus === 'CANCELLED' && refundCoverage < paidTotal) {
      findings.push({ orderId: snapshot.orderId, code: 'CANCELLED_CAPTURE_WITHOUT_REFUND' });
    }
  }

  for (const refund of snapshot.refunds) {
    if (
      ['REQUESTED', 'PROCESSING'].includes(refund.status) &&
      now.getTime() - refund.createdAt.getTime() >= staleAfterMs
    ) {
      findings.push({
        orderId: snapshot.orderId,
        code: 'STALE_REFUND_RESERVATION',
        recordId: refund.id,
      });
    } else if (refund.status === 'FAILED') {
      findings.push({
        orderId: snapshot.orderId,
        code: 'FAILED_REFUND_REVIEW',
        recordId: refund.id,
      });
    }
  }
  return findings;
}

const RECONCILIATION_SELECT = {
  id: true,
  status: true,
  paymentMethod: true,
  paymentStatus: true,
  grandTotal: true,
  refundedTotal: true,
  payments: {
    select: { id: true, status: true, amount: true, refundedTotal: true },
  },
  refunds: {
    select: {
      id: true,
      paymentId: true,
      amount: true,
      status: true,
      providerRefundId: true,
      createdAt: true,
    },
  },
} satisfies Prisma.OrderSelect;

/**
 * Bounded read-only scan. It never writes, settles, retries, or alters records.
 * Stale/failed reservations are surfaced for provider verification/manual work.
 */
export async function inspectFinancialReconciliation(
  options: {
    take?: number;
    staleAfterMs?: number;
    now?: Date;
  } = {}
): Promise<ReconciliationFinding[]> {
  const take = Math.min(Math.max(Math.trunc(options.take ?? 250), 1), 1_000);
  const orders = await prisma.order.findMany({
    select: RECONCILIATION_SELECT,
    orderBy: { updatedAt: 'asc' },
    take,
  });
  const now = options.now ?? new Date();
  return orders.flatMap((order) =>
    reconcileFinancialSnapshot(
      {
        orderId: order.id,
        orderStatus: order.status,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        grandTotalPaise: toPaise(order.grandTotal),
        refundedTotalPaise: toPaise(order.refundedTotal),
        payments: order.payments.map((payment) => ({
          id: payment.id,
          status: payment.status,
          amountPaise: toPaise(payment.amount),
          refundedTotalPaise: toPaise(payment.refundedTotal),
        })),
        refunds: order.refunds.map((refund) => ({
          id: refund.id,
          paymentId: refund.paymentId,
          amountPaise: toPaise(refund.amount),
          status: refund.status,
          providerRefundId: refund.providerRefundId,
          createdAt: refund.createdAt,
        })),
      },
      now,
      options.staleAfterMs
    )
  );
}
