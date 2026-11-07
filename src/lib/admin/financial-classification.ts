export type CollectionPaymentStatus =
  'CREATED' | 'PENDING' | 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'FAILED';
export type CollectionRefundStatus = 'REQUESTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface CollectionOrder {
  paymentMethod: string;
  paymentStatus: string;
  grandTotalPaise: number;
  payments: Array<{
    id: string;
    provider: string;
    status: CollectionPaymentStatus;
    amountPaise: number;
  }>;
  refunds: Array<{ paymentId: string | null; status: CollectionRefundStatus; amountPaise: number }>;
}

export interface CollectionTotals {
  gatewayCollectedPaise: number;
  codCollectedPaise: number;
  codUncollectedPaise: number;
  testTransactionsPaise: number;
  completedRefundsPaise: number;
  pendingRefundsPaise: number;
  failedRefundsPaise: number;
  netCollectedPaise: number;
}

/**
 * Cash classification is deliberately separate from booked order value and
 * profit: TEST and unpaid COD are never presented as real collections, and
 * only COMPLETED refunds reduce net collections.
 */
export function classifyCollections(orders: readonly CollectionOrder[]): CollectionTotals {
  let gatewayCollectedPaise = 0;
  let codCollectedPaise = 0;
  let codUncollectedPaise = 0;
  let testTransactionsPaise = 0;
  let completedRefundsPaise = 0;
  let realCompletedRefundsPaise = 0;
  let pendingRefundsPaise = 0;
  let failedRefundsPaise = 0;

  for (const order of orders) {
    const paidPayments = order.payments.filter((payment) =>
      ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(payment.status)
    );
    for (const payment of paidPayments) {
      if (payment.provider === 'TEST') testTransactionsPaise += payment.amountPaise;
      else gatewayCollectedPaise += payment.amountPaise;
    }

    const isCodCollected =
      order.paymentMethod === 'COD' &&
      ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(order.paymentStatus);
    if (isCodCollected) codCollectedPaise += order.grandTotalPaise;
    if (order.paymentMethod === 'COD' && order.paymentStatus === 'COD_PENDING') {
      codUncollectedPaise += order.grandTotalPaise;
    }

    const providerByPaymentId = new Map(
      order.payments.map((payment) => [payment.id, payment.provider])
    );
    for (const refund of order.refunds) {
      if (refund.status === 'COMPLETED') {
        completedRefundsPaise += refund.amountPaise;
        const provider = refund.paymentId ? providerByPaymentId.get(refund.paymentId) : undefined;
        if (provider !== 'TEST' && (provider != null || isCodCollected)) {
          realCompletedRefundsPaise += refund.amountPaise;
        }
      } else if (refund.status === 'REQUESTED' || refund.status === 'PROCESSING') {
        pendingRefundsPaise += refund.amountPaise;
      } else {
        failedRefundsPaise += refund.amountPaise;
      }
    }
  }

  return {
    gatewayCollectedPaise,
    codCollectedPaise,
    codUncollectedPaise,
    testTransactionsPaise,
    completedRefundsPaise,
    pendingRefundsPaise,
    failedRefundsPaise,
    netCollectedPaise: gatewayCollectedPaise + codCollectedPaise - realCompletedRefundsPaise,
  };
}
