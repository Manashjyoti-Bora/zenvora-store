/**
 * Historical order wording is derived from the payment records ON THAT ORDER,
 * never from the provider that happens to be configured today. This keeps old
 * TEST simulations and real Razorpay payments truthful after configuration
 * changes, and keeps manual COD refunds separate from gateway refunds.
 */

export interface OrderPaymentAttempt {
  provider: string;
  status: string;
  createdAt?: Date;
  paidAt?: Date | null;
}

export interface OrderPaymentCopyInput {
  paymentMethod: string;
  paymentStatus: string;
  payments?: readonly OrderPaymentAttempt[];
}

export interface OrderPaymentCopy {
  provider: 'RAZORPAY' | 'TEST' | null;
  isTest: boolean;
  methodLabel: string;
  confirmationTitle: string;
  confirmationDetail: string;
  paymentFailureDetail: string;
  refundPendingDetail: string;
  refundCompletedDetail: string;
}

const CAPTURED_STATUSES = new Set(['PAID', 'CAPTURED']);
const PAID_ORDER_STATUSES = new Set(['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']);

function timeOf(attempt: OrderPaymentAttempt): number {
  return (attempt.paidAt ?? attempt.createdAt)?.getTime() ?? 0;
}

/** Prefer the captured attempt; otherwise use the newest recorded attempt. */
export function recordedPaymentProvider(
  payments: readonly OrderPaymentAttempt[] = []
): 'RAZORPAY' | 'TEST' | null {
  const sorted = [...payments].sort((a, b) => timeOf(b) - timeOf(a));
  const selected = sorted.find((payment) => CAPTURED_STATUSES.has(payment.status)) ?? sorted[0];
  return selected?.provider === 'RAZORPAY' || selected?.provider === 'TEST'
    ? selected.provider
    : null;
}

export function describeOrderPayment(input: OrderPaymentCopyInput): OrderPaymentCopy {
  const provider = input.paymentMethod === 'COD' ? null : recordedPaymentProvider(input.payments);
  const isTest = provider === 'TEST';
  const wasPaid = PAID_ORDER_STATUSES.has(input.paymentStatus);
  const failed = input.paymentStatus === 'FAILED';

  if (input.paymentMethod === 'COD') {
    return {
      provider: null,
      isTest: false,
      methodLabel: 'Cash on Delivery',
      confirmationTitle: wasPaid ? 'Cash collection recorded' : 'Order confirmed',
      confirmationDetail: wasPaid
        ? 'The store has recorded cash collection for this Cash on Delivery order.'
        : 'Pay the order total in cash when your order is delivered.',
      paymentFailureDetail: 'This is a Cash on Delivery order; no online payment was attempted.',
      refundPendingDetail:
        'This is a manual Cash on Delivery refund handled by the store. No payment gateway is involved; contact support for the settlement reference and timing.',
      refundCompletedDetail:
        'The store has marked this manual Cash on Delivery refund as settled. No payment gateway was used. This is an internal settlement record, not independent proof of a bank deposit; contact support with your settlement reference if you have not received it.',
    };
  }

  if (isTest) {
    return {
      provider,
      isTest,
      methodLabel: 'TEST payment (simulation only)',
      confirmationTitle: wasPaid
        ? 'TEST payment simulated successfully'
        : failed
          ? 'TEST payment simulation failed'
          : 'TEST payment simulation pending',
      confirmationDetail: wasPaid
        ? 'This order used the TEST payment simulator. No real money moved and this was not a live gateway charge.'
        : 'This is a TEST payment simulation only. No real money moved and no real card or bank credentials were used.',
      paymentFailureDetail:
        'The TEST payment simulation did not complete. No real money moved; you can retry the simulation without entering real payment credentials.',
      refundPendingDetail:
        'This is a TEST refund simulation recorded against a simulated payment. No real money moves and no bank or card refund is created.',
      refundCompletedDetail:
        'This TEST refund simulation is marked completed. No real money moved and no bank or card refund was created.',
    };
  }

  if (provider === 'RAZORPAY') {
    return {
      provider,
      isTest: false,
      methodLabel: 'Online payment (Razorpay)',
      confirmationTitle: wasPaid
        ? 'Razorpay payment confirmed'
        : failed
          ? 'Razorpay payment not completed'
          : 'Razorpay payment pending',
      confirmationDetail: wasPaid
        ? 'The Razorpay payment recorded on this order is confirmed.'
        : failed
          ? 'The latest Razorpay attempt was not completed. Check the order status before retrying; contact support if your bank shows a debit.'
          : 'Razorpay confirmation is still pending. Check this order again before attempting another payment.',
      paymentFailureDetail:
        'The Razorpay payment could not be confirmed. If your bank shows a debit, do not retry; contact support with the order number so the payment can be reconciled.',
      refundPendingDetail:
        'The refund has been initiated with Razorpay. After Razorpay processes it, your bank or card issuer may take another 5–7 business days to post the credit.',
      refundCompletedDetail:
        'Razorpay has marked this refund as processed. Your bank or card issuer may take another 5–7 business days to post the credit.',
    };
  }

  return {
    provider: null,
    isTest: false,
    methodLabel: 'Online payment',
    confirmationTitle: wasPaid
      ? 'Online payment confirmed'
      : failed
        ? 'Online payment not completed'
        : 'Online payment pending',
    confirmationDetail: wasPaid
      ? 'An online payment is recorded as confirmed on this order. No provider detail was stored on the historical payment attempt.'
      : 'No online payment is confirmed yet. Check this order again before attempting another payment.',
    paymentFailureDetail:
      'The online payment could not be confirmed. If your bank shows a debit, do not retry; contact support with the order number.',
    refundPendingDetail:
      'The store is processing this refund using the payment route recorded on the order. Contact support for provider-specific status and timing.',
    refundCompletedDetail:
      'The store has recorded this refund as completed. Contact support if the credit has not appeared after the provider and bank processing window.',
  };
}
