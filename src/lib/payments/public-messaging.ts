export type PublicPaymentProvider = 'RAZORPAY' | 'TEST' | 'NONE';

export interface PublicPaymentState {
  provider: PublicPaymentProvider;
  codEnabled: boolean;
}

/**
 * Single source of truth for customer-facing payment availability.
 *
 * NONE must never advertise an online method. TEST must always identify itself
 * as a simulation and must never look like a real Razorpay integration. These
 * strings are presentation only; checkout authorization remains server-side.
 */
export function publicPaymentMethodLabel({ provider, codEnabled }: PublicPaymentState): string {
  const cod = codEnabled ? 'Cash on Delivery' : null;
  if (provider === 'NONE') return cod ?? 'Payment methods unavailable';
  if (provider === 'TEST') {
    const online = 'TEST payment (no real money)';
    return cod ? `${online} + ${cod}` : online;
  }
  return cod ? `Online payment + ${cod}` : 'Online payment';
}

export function publicPaymentTrustLabel(state: PublicPaymentState): string {
  if (state.provider === 'NONE') {
    return state.codEnabled ? 'Cash on Delivery' : 'Online payments not configured';
  }
  if (state.provider === 'TEST') {
    return state.codEnabled
      ? 'TEST payments (no real money) + Cash on Delivery'
      : 'TEST payments (no real money)';
  }
  return state.codEnabled
    ? 'Secure online payments via Razorpay + Cash on Delivery'
    : 'Secure online payments via Razorpay';
}

export function publicCheckoutInstruction({ provider, codEnabled }: PublicPaymentState): string {
  if (provider === 'NONE') {
    return codEnabled
      ? 'Choose Cash on Delivery at checkout. Online payments are not currently available.'
      : 'Checkout is unavailable until a payment method is configured.';
  }
  if (provider === 'TEST') {
    return codEnabled
      ? 'Use the clearly marked TEST payment simulator (no real money moves) or choose Cash on Delivery.'
      : 'Use the clearly marked TEST payment simulator; no real money moves.';
  }
  return codEnabled
    ? 'Pay online via Razorpay or choose Cash on Delivery.'
    : 'Pay online via Razorpay.';
}

export function publicPaymentFaqAnswer({ provider, codEnabled }: PublicPaymentState): string {
  if (provider === 'NONE') {
    return codEnabled
      ? 'Cash on Delivery is available. Online payments are not currently configured.'
      : 'Online payments are not configured and Cash on Delivery is unavailable.';
  }
  if (provider === 'TEST') {
    return codEnabled
      ? 'A clearly marked TEST payment simulator is available in this development environment; no real money moves. Cash on Delivery is also available.'
      : 'A clearly marked TEST payment simulator is available in this development environment; no real money moves.';
  }
  return codEnabled
    ? 'Online payment via UPI, cards and netbanking through Razorpay, or Cash on Delivery. Card and UPI credentials are entered only in the gateway secure window.'
    : 'Online payment via UPI, cards and netbanking through Razorpay. Card and UPI credentials are entered only in the gateway secure window.';
}

export function publicPaymentSafetyFaq({ provider, codEnabled }: PublicPaymentState): {
  question: string;
  answer: string;
} {
  if (provider === 'NONE') {
    return {
      question: 'How is my order confirmed without online payment?',
      answer: codEnabled
        ? 'Cash on Delivery orders are confirmed at checkout and paid when the order arrives. Online card, UPI and netbanking payments are not currently accepted.'
        : 'Online payments are not currently accepted and Cash on Delivery is unavailable, so checkout cannot be completed yet.',
    };
  }
  if (provider === 'TEST') {
    return {
      question: 'Does the TEST payment simulator move real money?',
      answer:
        'No. TEST payments are development-only simulations and are labelled in order history. They never represent a real bank debit or gateway collection.',
    };
  }
  return {
    question: 'Is my payment safe? What if money is debited but the order fails?',
    answer:
      'Payments are confirmed only after server-side verification with Razorpay. If money is debited but the order is not confirmed, do not pay again - contact support with your order number. Unsettled amounts are typically auto-refunded by the gateway within 5-7 business days.',
  };
}

export function publicCancellationFaqAnswer({ provider }: PublicPaymentState): string {
  const online =
    provider === 'RAZORPAY'
      ? 'An eligible confirmed Razorpay payment is refunded in full, including shipping, to the original payment method after cancellation.'
      : provider === 'TEST'
        ? 'TEST payment cancellations and refunds are simulations; no real money moves.'
        : 'New orders do not involve an online payment or online-payment refund while online payments are not configured.';
  return `${online} COD cancellation does not use a payment gateway; if cash has already been collected, any refund requires manual settlement.`;
}

export function publicReturnRefundFaqAnswer({ provider }: PublicPaymentState): string {
  if (provider === 'RAZORPAY') {
    return 'Approved Razorpay refunds are initiated to the original payment method after the returned item is received and checked; the bank or card issuer may take another 5-7 business days. Collected-COD refunds are settled manually by the store, not through a payment gateway.';
  }
  if (provider === 'TEST') {
    return 'TEST return refunds are simulations; no real money moves. Collected-COD refunds are settled manually by the store, not through a payment gateway.';
  }
  return 'New online payments are unavailable because no online payment provider is configured. Approved collected-COD refunds are settled manually by the store; support confirms the settlement method and reference.';
}

/** Null means the online radio option must not be rendered at all. */
export function onlinePaymentOptionLabel(provider: PublicPaymentProvider): string | null {
  if (provider === 'NONE') return null;
  if (provider === 'TEST') return 'TEST payment (simulation only — no real money)';
  return 'Pay online (UPI / cards / netbanking)';
}
