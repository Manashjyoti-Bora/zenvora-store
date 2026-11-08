export interface RefundObligation {
  amountPaise: number;
}

export interface RefundCapacity {
  capturedPaise: number;
  reservedPaise: number;
  refundablePaise: number;
}

/**
 * Capacity policy, deliberately separate from the historical accounting
 * ledger. Every refund row is a permanent obligation for future reservations:
 * REQUESTED/PROCESSING reserve capacity, COMPLETED is settled money, and
 * FAILED remains unresolved until that same row is settled or reconciled.
 *
 * This function does NOT redefine Order.refundedTotal or actualProfit.
 */
export function calculateRefundCapacity(
  capturedPaise: number,
  obligations: readonly RefundObligation[]
): RefundCapacity {
  const reservedPaise = obligations.reduce((sum, refund) => sum + refund.amountPaise, 0);
  return {
    capturedPaise,
    reservedPaise,
    refundablePaise: Math.max(0, capturedPaise - reservedPaise),
  };
}
