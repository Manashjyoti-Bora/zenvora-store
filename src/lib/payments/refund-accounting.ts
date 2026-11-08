export type RefundLedgerStatus = 'REQUESTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface RefundLedgerEntry {
  amountPaise: number;
  status: RefundLedgerStatus;
}

/** Only provider/manual-confirmed settlement is money returned to a customer. */
export function settledRefundTotalPaise(refunds: readonly RefundLedgerEntry[]): number {
  return refunds.reduce(
    (sum, refund) => sum + (refund.status === 'COMPLETED' ? refund.amountPaise : 0),
    0
  );
}

/** Non-failed requests reserve refundable balance; FAILED is a confirmed no-movement result. */
export function reservedRefundTotalPaise(refunds: readonly RefundLedgerEntry[]): number {
  return refunds.reduce(
    (sum, refund) => sum + (refund.status === 'FAILED' ? 0 : refund.amountPaise),
    0
  );
}

export function paymentRefundStatus(
  paymentAmountPaise: number,
  settledRefundPaise: number
): 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED' {
  if (settledRefundPaise >= paymentAmountPaise) return 'REFUNDED';
  return settledRefundPaise > 0 ? 'PARTIALLY_REFUNDED' : 'PAID';
}

export function isRefundFullySettled(paidPaise: number, settledRefundPaise: number): boolean {
  return paidPaise > 0 && settledRefundPaise >= paidPaise;
}
