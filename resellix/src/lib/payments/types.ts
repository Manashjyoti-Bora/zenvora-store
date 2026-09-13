/**
 * Payment provider abstraction.
 *
 * Adding a gateway later (e.g. Cashfree, PayU, Stripe) means implementing
 * this interface and registering it in `index.ts` - nothing else changes.
 */

export type PaymentProviderKind = 'RAZORPAY' | 'TEST';

export interface CreatePaymentOrderInput {
  orderId: string;
  orderNumber: string;
  amountPaise: number;
  currency: string;
  customer?: { name?: string; email?: string; phone?: string };
}

export type CheckoutMode = 'razorpay-checkout-js' | 'test-simulator' | 'unconfigured';

export interface CreatePaymentOrderResult {
  provider: PaymentProviderKind;
  providerOrderId: string;
  amountPaise: number;
  currency: string;
  checkoutMode: CheckoutMode;
  /** Public key id needed by Razorpay Checkout.js (safe for browsers). */
  keyId?: string;
  notes?: Record<string, string>;
}

export type PaymentOutcome = 'PAID' | 'FAILED' | 'PENDING';

export interface VerifyPaymentInput {
  providerOrderId: string;
  providerPaymentId?: string;
  signature?: string;
  /** Expected amount for a server-side double-check (paise). */
  expectedAmountPaise?: number;
}

export interface VerifyPaymentResult {
  outcome: PaymentOutcome;
  providerPaymentId?: string;
  method?: string;
  feePaise?: number | null;
  failureReason?: string;
  /** How the verification was established (audit trail). */
  verifiedVia: 'gateway-fetch+signature' | 'gateway-fetch' | 'signature';
  raw?: Record<string, unknown>;
}

export interface RefundInput {
  providerPaymentId: string;
  amountPaise: number;
  reason?: string;
}

export interface RefundResult {
  providerRefundId: string | null;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  failureReason?: string;
  raw?: Record<string, unknown>;
}

export interface WebhookValidation {
  valid: boolean;
  reason?: string;
}

export interface PaymentProviderAdapter {
  readonly kind: PaymentProviderKind;
  readonly label: string;
  isConfigured(): boolean;
  createPaymentOrder(input: CreatePaymentOrderInput): Promise<CreatePaymentOrderResult>;
  verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult>;
  refund(input: RefundInput): Promise<RefundResult>;
  /** Validate an incoming webhook request (signature/shared secret). */
  validateWebhook(rawBody: string, signatureHeader: string | null): Promise<WebhookValidation>;
}

/** Thrown when no payment provider is usable (missing credentials). */
export class PaymentsNotConfiguredError extends Error {
  constructor() {
    super(
      'No payment provider is configured. Set RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET (production) or enable PAYMENTS_TEST_MODE (development). See SETUP_CHECKLIST.md.'
    );
    this.name = 'PaymentsNotConfiguredError';
  }
}
