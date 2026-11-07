import { describe, expect, it } from 'vitest';
import {
  isRefundFullySettled,
  paymentRefundStatus,
  reservedRefundTotalPaise,
  settledRefundTotalPaise,
  type RefundLedgerEntry,
} from '@/lib/payments/refund-accounting';

const rows = (...items: RefundLedgerEntry[]) => items;

describe('refund ledger accounting', () => {
  it('does not treat REQUESTED or PROCESSING reservations as settled refunds', () => {
    const refunds = rows(
      { amountPaise: 4_000, status: 'REQUESTED' },
      { amountPaise: 6_000, status: 'PROCESSING' },
      { amountPaise: 2_000, status: 'COMPLETED' }
    );

    expect(settledRefundTotalPaise(refunds)).toBe(2_000);
    expect(reservedRefundTotalPaise(refunds)).toBe(12_000);
  });

  it('releases a definitively failed refund reservation without counting it as settled', () => {
    const refunds = rows(
      { amountPaise: 5_000, status: 'FAILED' },
      { amountPaise: 1_500, status: 'COMPLETED' }
    );

    expect(settledRefundTotalPaise(refunds)).toBe(1_500);
    expect(reservedRefundTotalPaise(refunds)).toBe(1_500);
  });

  it('marks Payment refunded only at settled amount and leaves it PAID before settlement', () => {
    expect(paymentRefundStatus(10_000, 0)).toBe('PAID');
    expect(paymentRefundStatus(10_000, 9_999)).toBe('PARTIALLY_REFUNDED');
    expect(paymentRefundStatus(10_000, 10_000)).toBe('REFUNDED');
    expect(paymentRefundStatus(10_000, 12_000)).toBe('REFUNDED');
  });

  it('requires a positive paid balance and completed settlement for fully refunded', () => {
    expect(isRefundFullySettled(10_000, 9_999)).toBe(false);
    expect(isRefundFullySettled(10_000, 10_000)).toBe(true);
    expect(isRefundFullySettled(0, 1)).toBe(false);
  });
});
