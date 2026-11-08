import { describe, expect, it } from 'vitest';
import { classifyCollections } from '@/lib/admin/financial-classification';

describe('financial collection classification', () => {
  it('separates real gateway collection, TEST payments, and uncollected COD', () => {
    const totals = classifyCollections([
      {
        paymentMethod: 'PREPAID_GATEWAY',
        paymentStatus: 'PAID',
        grandTotalPaise: 10_000,
        payments: [
          { id: 'real', provider: 'RAZORPAY', status: 'PAID', amountPaise: 10_000 },
          { id: 'test', provider: 'TEST', status: 'PAID', amountPaise: 3_000 },
        ],
        refunds: [],
      },
      {
        paymentMethod: 'COD',
        paymentStatus: 'COD_PENDING',
        grandTotalPaise: 5_000,
        payments: [],
        refunds: [],
      },
    ]);

    expect(totals.gatewayCollectedPaise).toBe(10_000);
    expect(totals.testTransactionsPaise).toBe(3_000);
    expect(totals.codCollectedPaise).toBe(0);
    expect(totals.codUncollectedPaise).toBe(5_000);
    expect(totals.netCollectedPaise).toBe(10_000);
  });

  it('subtracts only completed real refunds; pending and failed refunds stay separate', () => {
    const totals = classifyCollections([
      {
        paymentMethod: 'PREPAID_GATEWAY',
        paymentStatus: 'PARTIALLY_REFUNDED',
        grandTotalPaise: 12_000,
        payments: [
          { id: 'real', provider: 'RAZORPAY', status: 'PARTIALLY_REFUNDED', amountPaise: 12_000 },
        ],
        refunds: [
          { paymentId: 'real', status: 'COMPLETED', amountPaise: 2_000 },
          { paymentId: 'real', status: 'PROCESSING', amountPaise: 1_500 },
          { paymentId: 'real', status: 'FAILED', amountPaise: 500 },
        ],
      },
    ]);

    expect(totals.completedRefundsPaise).toBe(2_000);
    expect(totals.pendingRefundsPaise).toBe(1_500);
    expect(totals.failedRefundsPaise).toBe(500);
    expect(totals.netCollectedPaise).toBe(10_000);
  });

  it('does not subtract TEST refunds from real cash collections', () => {
    const totals = classifyCollections([
      {
        paymentMethod: 'PREPAID_GATEWAY',
        paymentStatus: 'REFUNDED',
        grandTotalPaise: 4_000,
        payments: [{ id: 'test', provider: 'TEST', status: 'REFUNDED', amountPaise: 4_000 }],
        refunds: [{ paymentId: 'test', status: 'COMPLETED', amountPaise: 4_000 }],
      },
    ]);

    expect(totals.completedRefundsPaise).toBe(4_000);
    expect(totals.testTransactionsPaise).toBe(4_000);
    expect(totals.gatewayCollectedPaise).toBe(0);
    expect(totals.netCollectedPaise).toBe(0);
  });
});
