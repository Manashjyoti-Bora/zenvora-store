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

/**
 * Every durable reservation retains capacity until its final outcome is known.
 * FAILED is unresolved, not proof that no money moved: a verified later
 * COMPLETED event may settle the same reservation, so capacity cannot be
 * safely released to a replacement refund.
 */
export function reservedRefundTotalPaise(refunds: readonly RefundLedgerEntry[]): number {
  return refunds.reduce((sum, refund) => sum + refund.amountPaise, 0);
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
