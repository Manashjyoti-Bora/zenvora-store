import { describe, expect, it } from 'vitest';
import { calculateRefundCapacity } from '@/lib/payments/refund-policy';

describe('refund reservation capacity policy', () => {
  it('subtracts completed, pending, and unresolved failed obligations', () => {
    expect(
      calculateRefundCapacity(100_000, [
        { amountPaise: 10_000 },
        { amountPaise: 40_000 },
        { amountPaise: 20_000 },
      ])
    ).toEqual({ capturedPaise: 100_000, reservedPaise: 70_000, refundablePaise: 30_000 });
  });

  it('fails closed when historical rows are already over-allocated', () => {
    expect(calculateRefundCapacity(10_000, [{ amountPaise: 12_000 }])).toEqual({
      capturedPaise: 10_000,
      reservedPaise: 12_000,
      refundablePaise: 0,
    });
  });

  it('does not treat an unresolved failed refund as released capacity', () => {
    const failedObligation = [{ amountPaise: 60_000 }];
    expect(calculateRefundCapacity(100_000, failedObligation).refundablePaise).toBe(40_000);
    expect(calculateRefundCapacity(100_000, failedObligation).refundablePaise).not.toBe(100_000);
  });
});
