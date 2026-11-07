import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));

import {
  reconcileFinancialSnapshot,
  type FinancialSnapshot,
} from '@/lib/admin/financial-reconciliation';

const now = new Date('2026-11-07T12:00:00.000Z');

function base(overrides: Partial<FinancialSnapshot> = {}): FinancialSnapshot {
  return {
    orderId: 'order-1',
    orderStatus: 'DELIVERED',
    paymentMethod: 'PREPAID_GATEWAY',
    paymentStatus: 'PAID',
    grandTotalPaise: 10_000,
    refundedTotalPaise: 0,
    payments: [{ id: 'payment-1', status: 'PAID', amountPaise: 10_000, refundedTotalPaise: 0 }],
    refunds: [],
    ...overrides,
  };
}

describe('read-only financial reconciliation', () => {
  it('detects PROCESSING incorrectly counted as a completed refund', () => {
    const findings = reconcileFinancialSnapshot(
      base({
        orderStatus: 'REFUNDED',
        paymentStatus: 'REFUNDED',
        refundedTotalPaise: 10_000,
        payments: [
          { id: 'payment-1', status: 'REFUNDED', amountPaise: 10_000, refundedTotalPaise: 10_000 },
        ],
        refunds: [
          {
            id: 'refund-1',
            paymentId: 'payment-1',
            amountPaise: 10_000,
            status: 'PROCESSING',
            providerRefundId: 'provider-refund-1',
            createdAt: new Date(now.getTime() - 60 * 60_000),
          },
        ],
      }),
      now
    );

    expect(findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        'ORDER_REFUNDED_TOTAL_MISMATCH',
        'PAYMENT_REFUNDED_TOTAL_MISMATCH',
        'PAYMENT_REFUND_STATUS_MISMATCH',
        'ORDER_PAYMENT_STATUS_MISMATCH',
        'ORDER_MARKED_REFUNDED_BEFORE_SETTLEMENT',
        'STALE_REFUND_RESERVATION',
      ])
    );
  });

  it('returns no findings when a partial completed refund matches all stored aggregates', () => {
    const findings = reconcileFinancialSnapshot(
      base({
        paymentStatus: 'PARTIALLY_REFUNDED',
        refundedTotalPaise: 2_500,
        payments: [
          {
            id: 'payment-1',
            status: 'PARTIALLY_REFUNDED',
            amountPaise: 10_000,
            refundedTotalPaise: 2_500,
          },
        ],
        refunds: [
          {
            id: 'refund-1',
            paymentId: 'payment-1',
            amountPaise: 2_500,
            status: 'COMPLETED',
            providerRefundId: 'provider-refund-1',
            createdAt: now,
          },
        ],
      }),
      now
    );

    expect(findings).toEqual([]);
  });

  it('surfaces captured cancelled orders with no refund coverage', () => {
    const findings = reconcileFinancialSnapshot(
      base({ orderStatus: 'CANCELLED', paymentStatus: 'PAID' }),
      now
    );
    expect(findings).toContainEqual({
      orderId: 'order-1',
      code: 'CANCELLED_CAPTURE_WITHOUT_REFUND',
    });
  });

  it('flags FAILED refunds for review without counting them as settled', () => {
    const findings = reconcileFinancialSnapshot(
      base({
        refunds: [
          {
            id: 'refund-failed',
            paymentId: 'payment-1',
            amountPaise: 3_000,
            status: 'FAILED',
            providerRefundId: null,
            createdAt: now,
          },
        ],
      }),
      now
    );

    expect(findings).toContainEqual({
      orderId: 'order-1',
      code: 'FAILED_REFUND_REVIEW',
      recordId: 'refund-failed',
    });
    expect(findings.some((finding) => finding.code === 'ORDER_REFUNDED_TOTAL_MISMATCH')).toBe(
      false
    );
    expect(findings.some((finding) => finding.code === 'PAYMENT_REFUND_STATUS_MISMATCH')).toBe(
      false
    );
  });
});
