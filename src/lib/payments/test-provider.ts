import { isTestPaymentsAllowed } from '../env';
import { randomCode } from '../crypto';
import type {
  CreatePaymentOrderInput,
  CreatePaymentOrderResult,
  PaymentProviderAdapter,
  RefundInput,
  RefundResult,
  VerifyPaymentInput,
  VerifyPaymentResult,
  WebhookValidation,
} from './types';

/**
 * TEST payment provider - DEVELOPMENT/TESTING ONLY.
 *
 * Hard gates (enforced by `isTestPaymentsAllowed()`):
 *   - Enabled only when PAYMENTS_TEST_MODE=true
 *   - AND NODE_ENV is NOT production
 *
 * It simulates a gateway so the complete order pipeline (verification ->
 * confirmation -> supplier fulfilment -> tracking -> notifications) can be
 * exercised and E2E-tested without real credentials. Every artifact it
 * produces is labelled TEST (provider=TEST on payments, `*_TEST_*` ids) so
 * test data can never be mistaken for real payment status.
 */
export class TestPaymentAdapter implements PaymentProviderAdapter {
  readonly kind = 'TEST' as const;
  readonly label = 'TEST provider (development only)';

  isConfigured(): boolean {
    return isTestPaymentsAllowed();
  }

  async createPaymentOrder(input: CreatePaymentOrderInput): Promise<CreatePaymentOrderResult> {
    if (!this.isConfigured()) throw new Error('Test payments are not allowed in this environment');
    return {
      provider: this.kind,
      providerOrderId: `order_TEST_${randomCode(10)}`,
      amountPaise: input.amountPaise,
      currency: input.currency,
      checkoutMode: 'test-simulator',
    };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    // The TEST provider has no browser handshake; outcomes are driven by the
    // simulate endpoint through the same internal confirmation pipeline.
    return {
      outcome: 'PENDING',
      providerPaymentId: input.providerPaymentId,
      verifiedVia: 'gateway-fetch',
    };
  }

  async validateWebhook(
    _rawBody: string,
    _signatureHeader: string | null
  ): Promise<WebhookValidation> {
    return { valid: false, reason: 'The TEST provider does not accept external webhooks' };
  }

  async refund(_input: RefundInput): Promise<RefundResult> {
    if (!this.isConfigured()) throw new Error('Test payments are not allowed in this environment');
    return {
      providerRefundId: `re_TEST_${randomCode(8)}`,
      status: 'COMPLETED',
      raw: { test: true },
    };
  }
}
