import { prisma } from '../db';
import crypto from 'node:crypto';
import { logger, sanitizeForLog } from '../logger';
import { safeJsonParse } from '../utils';
import { RazorpayAdapter } from './razorpay';
import { confirmPaymentResult } from './confirm';
import { settleRefund } from './refunds';
import type { Prisma } from '@prisma/client';

/**
 * Razorpay webhook processing.
 *
 * Pipeline:
 *  1. Verify HMAC signature over the RAW body (x-razorpay-signature).
 *  2. Idempotency: unique (provider, externalEventId) row in webhook_events.
 *     Duplicate deliveries are acked (200) without reprocessing.
 *  3. Route the event to the same confirmation pipeline used by checkout
 *     verification, so behaviour is identical and idempotent.
 */

interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

interface RazorpayPaymentEntityPayload {
  id?: string;
  entity?: {
    id?: string;
    order_id?: string;
    amount?: number;
    fee?: number;
    method?: string;
    error_description?: string;
    error_code?: string;
  };
}

interface RazorpayRefundEntityPayload {
  id?: string;
  entity?: { id?: string; status?: string; payment_id?: string; amount?: number };
}

export async function handleRazorpayWebhook(
  rawBody: string,
  signatureHeader: string | null,
  eventIdHeader: string | null
): Promise<WebhookResult> {
  const adapter = new RazorpayAdapter();
  const validation = await adapter.validateWebhook(rawBody, signatureHeader);

  const payload = safeJsonParse<Record<string, unknown>>(rawBody, {});
  const eventType = String(payload.event ?? 'unknown');
  const externalEventId =
    eventIdHeader ??
    (typeof payload.event_id === 'string' ? payload.event_id : null) ??
    // Last resort: content hash so replays of the exact same body dedupe.
    (rawBody ? `hash:${hashBody(rawBody)}` : null);

  // --- Idempotency guard ----------------------------------------------------
  let webhookEvent = null;
  if (externalEventId) {
    try {
      webhookEvent = await prisma.webhookEvent.create({
        data: {
          source: 'PAYMENT',
          provider: 'RAZORPAY',
          externalEventId,
          eventType,
          signatureValid: validation.valid,
          status: 'RECEIVED',
          payload: (sanitizeForLog(payload) ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        webhookEvent = await prisma.webhookEvent.findUnique({
          where: { provider_externalEventId: { provider: 'RAZORPAY', externalEventId } },
        });
        if (webhookEvent?.status === 'PROCESSED' || webhookEvent?.status === 'DUPLICATE') {
          logger.info('Duplicate Razorpay webhook ignored', { eventType, externalEventId });
          return { status: 200, body: { ok: true, duplicate: true } };
        }
      } else {
        throw err;
      }
    }
  }

  if (!validation.valid) {
    logger.error('Razorpay webhook signature verification failed', {
      eventType,
      reason: validation.reason,
    });
    if (webhookEvent) {
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: 'REJECTED', error: validation.reason ?? 'invalid signature' },
      });
    }
    return { status: 400, body: { ok: false, error: 'Invalid webhook signature' } };
  }

  try {
    const result = await routeRazorpayEvent(eventType, payload);
    if (webhookEvent) {
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
          orderId: result.orderId ?? null,
          paymentId: result.paymentId ?? null,
        },
      });
    }
    return { status: 200, body: { ok: true, handled: result.handled } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Razorpay webhook processing failed', { eventType, error: message });
    if (webhookEvent) {
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: 'FAILED', error: message.slice(0, 500) },
      });
    }
    // 500 makes Razorpay retry the delivery later.
    return { status: 500, body: { ok: false, error: 'Webhook processing failed' } };
  }
}

async function routeRazorpayEvent(
  eventType: string,
  payload: Record<string, unknown>
): Promise<{ handled: boolean; orderId?: string; paymentId?: string }> {
  const inner = (payload.payload ?? {}) as {
    payment?: RazorpayPaymentEntityPayload;
    refund?: RazorpayRefundEntityPayload;
  };
  const paymentPayload = inner.payment;
  const refundPayload = inner.refund;

  switch (eventType) {
    case 'payment.captured':
    case 'order.paid': {
      const entity = paymentPayload?.entity;
      if (!entity?.order_id) return { handled: false };
      const payment = await prisma.payment.findUnique({
        where: { providerOrderId: entity.order_id },
      });
      if (!payment) {
        logger.warn('Webhook for unknown provider order id', { providerOrderId: entity.order_id });
        return { handled: false };
      }
      await confirmPaymentResult({
        orderId: payment.orderId,
        provider: 'RAZORPAY',
        providerOrderId: entity.order_id,
        providerPaymentId: entity.id ?? null,
        outcome: 'PAID',
        amountPaise: typeof entity.amount === 'number' ? entity.amount : null,
        method: entity.method ?? null,
        feePaise: typeof entity.fee === 'number' ? entity.fee : null,
        verifiedVia: 'gateway-fetch',
        raw: sanitizeForLog(entity) as Record<string, unknown>,
        actorType: 'PAYMENT_PROVIDER',
      });
      return { handled: true, orderId: payment.orderId, paymentId: payment.id };
    }
    case 'payment.failed': {
      const entity = paymentPayload?.entity;
      if (!entity?.order_id) return { handled: false };
      const payment = await prisma.payment.findUnique({
        where: { providerOrderId: entity.order_id },
      });
      if (!payment) return { handled: false };
      await confirmPaymentResult({
        orderId: payment.orderId,
        provider: 'RAZORPAY',
        providerOrderId: entity.order_id,
        providerPaymentId: entity.id ?? null,
        outcome: 'FAILED',
        failureReason: entity.error_description ?? entity.error_code ?? 'Payment failed',
        actorType: 'PAYMENT_PROVIDER',
      });
      return { handled: true, orderId: payment.orderId, paymentId: payment.id };
    }
    case 'refund.processed': {
      const entity = refundPayload?.entity;
      if (!entity?.id) return { handled: false };
      await settleRefund({
        providerRefundId: entity.id,
        status: 'COMPLETED',
        actor: 'PAYMENT_PROVIDER',
      });
      const refund = await prisma.refund.findFirst({ where: { providerRefundId: entity.id } });
      return { handled: true, orderId: refund?.orderId };
    }
    case 'refund.failed': {
      const entity = refundPayload?.entity;
      if (!entity?.id) return { handled: false };
      await settleRefund({
        providerRefundId: entity.id,
        status: 'FAILED',
        failureReason: 'Gateway reported refund failure',
        actor: 'PAYMENT_PROVIDER',
      });
      const refund = await prisma.refund.findFirst({ where: { providerRefundId: entity.id } });
      return { handled: true, orderId: refund?.orderId };
    }
    case 'refund.pending':
    case 'refund.created': {
      // Recorded by webhook_events; settleRefund completes on refund.processed.
      return { handled: true };
    }
    default:
      logger.info('Razorpay webhook event stored (no handler)', { eventType });
      return { handled: false };
  }
}

function hashBody(body: string): string {
  return crypto.createHash('sha256').update(body).digest('hex').slice(0, 32);
}
