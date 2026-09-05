import Razorpay from 'razorpay';
import crypto from 'node:crypto';
import { env, isRazorpayConfigured } from '../env';
import { safeEqual } from '../crypto';
import { logger } from '../logger';
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
 * Razorpay adapter (official `razorpay` Node SDK).
 *
 * Security properties:
 * - Card numbers / CVV / UPI PINs never touch this server: Razorpay Checkout.js
 *   collects them on their PCI-DSS infrastructure; we only ever see tokens,
 *   ids, method labels and fees.
 * - Payment confirmation is INDEPENDENT of the browser: we re-fetch the
 *   payment entity from Razorpay's API and additionally verify the
 *   checkout signature (HMAC-SHA256 of `order_id|payment_id`).
 * - Webhooks are verified with the webhook signing secret over the raw body.
 */

interface RazorpayOrderEntity {
  id: string;
  amount: number;
  currency: string;
  status?: string;
}

interface RazorpayPaymentEntity {
  id: string;
  order_id?: string | null;
  amount: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  method?: string | null;
  fee?: number | null;
  error_code?: string | null;
  error_description?: string | null;
}

interface RazorpayRefundEntity {
  id: string;
  status: 'pending' | 'processed' | 'failed';
  amount: number;
}

export class RazorpayAdapter implements PaymentProviderAdapter {
  readonly kind = 'RAZORPAY' as const;
  readonly label = 'Razorpay';

  private client: Razorpay | null = null;

  isConfigured(): boolean {
    return isRazorpayConfigured();
  }

  private getClient(): Razorpay {
    if (!this.isConfigured()) {
      throw new Error('Razorpay credentials are not configured');
    }
    if (!this.client) {
      this.client = new Razorpay({
        key_id: env.RAZORPAY_KEY_ID!,
        key_secret: env.RAZORPAY_KEY_SECRET!,
      });
    }
    return this.client;
  }

  async createPaymentOrder(input: CreatePaymentOrderInput): Promise<CreatePaymentOrderResult> {
    const order = (await this.getClient().orders.create({
      amount: input.amountPaise,
      currency: input.currency,
      receipt: input.orderNumber,
      payment_capture: true, // auto-capture: money settles in one step
      notes: {
        orderNumber: input.orderNumber,
        customerEmail: input.customer?.email ?? '',
      },
    })) as unknown as RazorpayOrderEntity;
    return {
      provider: this.kind,
      providerOrderId: order.id,
      amountPaise: order.amount,
      currency: order.currency,
      checkoutMode: 'razorpay-checkout-js',
      keyId: env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? env.RAZORPAY_KEY_ID,
    };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    const signatureValid = this.verifyCheckoutSignature(
      input.providerOrderId,
      input.providerPaymentId ?? '',
      input.signature ?? ''
    );

    // Authoritative check: fetch the payment from Razorpay.
    try {
      const fetched = (await this.getClient().payments.fetch(
        input.providerPaymentId!
      )) as unknown as Record<string, unknown>;
      const payment: RazorpayPaymentEntity = {
        ...(fetched as unknown as RazorpayPaymentEntity),
        amount: Number(fetched.amount ?? 0),
        fee: fetched.fee == null ? null : Number(fetched.fee),
      };
      const amountOk =
        input.expectedAmountPaise === undefined || payment.amount === input.expectedAmountPaise;
      const orderOk = !payment.order_id || payment.order_id === input.providerOrderId;

      if (payment.status === 'captured' && amountOk && orderOk) {
        return {
          outcome: 'PAID',
          providerPaymentId: payment.id,
          method: payment.method ?? undefined,
          feePaise: typeof payment.fee === 'number' ? payment.fee : null,
          verifiedVia: signatureValid ? 'gateway-fetch+signature' : 'gateway-fetch',
          raw: sanitizePaymentEntity(payment),
        };
      }
      if (payment.status === 'failed') {
        return {
          outcome: 'FAILED',
          providerPaymentId: payment.id,
          failureReason: payment.error_description ?? payment.error_code ?? 'Payment failed',
          verifiedVia: 'gateway-fetch',
          raw: sanitizePaymentEntity(payment),
        };
      }
      return {
        outcome: 'PENDING',
        providerPaymentId: payment.id,
        verifiedVia: 'gateway-fetch',
        raw: sanitizePaymentEntity(payment),
      };
    } catch (fetchErr) {
      // Gateway unreachable: fall back to the documented signature check
      // (HMAC over order_id|payment_id with our secret). A valid signature
      // proves Razorpay processed this payment; the webhook remains the
      // final reconciler.
      logger.warn('Razorpay payment fetch failed during verification; falling back to signature', {
        error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
      });
      if (signatureValid) {
        return {
          outcome: 'PAID',
          providerPaymentId: input.providerPaymentId,
          verifiedVia: 'signature',
        };
      }
      return {
        outcome: 'FAILED',
        failureReason: 'Payment could not be verified (gateway unreachable and signature invalid)',
        verifiedVia: 'signature',
      };
    }
  }

  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
    if (!orderId || !paymentId || !signature) return false;
    if (!env.RAZORPAY_KEY_SECRET) return false;
    const expected = crypto
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    return safeEqual(expected, signature);
  }

  async validateWebhook(
    rawBody: string,
    signatureHeader: string | null
  ): Promise<WebhookValidation> {
    if (!env.RAZORPAY_WEBHOOK_SECRET) {
      return { valid: false, reason: 'RAZORPAY_WEBHOOK_SECRET is not configured on the server' };
    }
    if (!signatureHeader) return { valid: false, reason: 'Missing x-razorpay-signature header' };
    const expected = crypto
      .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');
    return safeEqual(expected, signatureHeader)
      ? { valid: true }
      : { valid: false, reason: 'Signature mismatch' };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const raw = (await this.getClient().payments.refund(input.providerPaymentId, {
      amount: input.amountPaise,
    })) as unknown as Record<string, unknown>;
    const refund: RazorpayRefundEntity = {
      id: String(raw.id ?? ''),
      status: (raw.status as RazorpayRefundEntity['status']) ?? 'pending',
      amount: Number(raw.amount ?? input.amountPaise),
    };
    return {
      providerRefundId: refund.id,
      status:
        refund.status === 'processed'
          ? 'COMPLETED'
          : refund.status === 'failed'
            ? 'FAILED'
            : 'PROCESSING',
      raw: { id: refund.id, status: refund.status, amount: refund.amount },
    };
  }
}

/** Keep only non-sensitive fields of a payment entity for audit storage. */
function sanitizePaymentEntity(p: RazorpayPaymentEntity): Record<string, unknown> {
  return {
    id: p.id,
    order_id: p.order_id ?? null,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    method: p.method ?? null,
    fee: p.fee ?? null,
    error_code: p.error_code ?? null,
    error_description: p.error_description ?? null,
  };
}
