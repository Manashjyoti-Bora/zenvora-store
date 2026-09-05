import crypto from 'node:crypto';
import { prisma } from '../db';
import { env } from '../env';
import { logger, sanitizeForLog } from '../logger';
import { safeJsonParse } from '../utils';
import { safeEqual, sha256 } from '../crypto';
import { applySupplierStatusUpdate, type SupplierStatusUpdate } from '../orders/fulfilment';
import type { Prisma } from '@prisma/client';

/**
 * Generic INBOUND supplier webhook.
 *
 * Contract (documented in docs/SUPPLIER_API.md so any supplier/3PL can push
 * status updates to us):
 *
 *   POST /api/suppliers/webhook
 *   Header: X-Supplier-Signature: HMAC-SHA256(raw_body, SUPPLIER_WEBHOOK_SECRET)
 *   Body: {
 *     "eventId": "unique-per-delivery",        // optional, idempotency
 *     "supplierSlug": "acme",                   // optional
 *     "supplierOrderId": "SUP-...",             // their id OR our internal id
 *     "status": "ACCEPTED|PROCESSING|SHIPPED|OUT_FOR_DELIVERY|DELIVERED|CANCELLED|REJECTED",
 *     "trackingNumber": "...", "carrier": "...", "trackingUrl": "...",
 *     "message": "...",
 *     "events": [{ "status": "...", "message": "...", "location": "...", "eventAt": "ISO" }]
 *   }
 *
 * Security: signature verified over the RAW body with a constant-time compare;
 * unverified deliveries are stored (REJECTED) and answered with 400.
 * Idempotency: unique (provider, externalEventId) - duplicates are acked
 * without reprocessing.
 */

export async function handleSupplierWebhook(
  rawBody: string,
  signatureHeader: string | null
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!env.SUPPLIER_WEBHOOK_SECRET) {
    logger.error('Supplier webhook received but SUPPLIER_WEBHOOK_SECRET is not configured');
    return {
      status: 503,
      body: { ok: false, error: 'Supplier webhooks are not configured on this server' },
    };
  }

  const expected = crypto
    .createHmac('sha256', env.SUPPLIER_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  const signatureValid = Boolean(signatureHeader) && safeEqual(expected, signatureHeader!);

  const payload = safeJsonParse<Record<string, unknown>>(rawBody, {});
  const supplierSlug = typeof payload.supplierSlug === 'string' ? payload.supplierSlug : 'supplier';
  const externalEventId =
    (typeof payload.eventId === 'string' && payload.eventId) || sha256(rawBody).slice(0, 32);

  let webhookEvent;
  try {
    webhookEvent = await prisma.webhookEvent.create({
      data: {
        source: 'SUPPLIER',
        provider: supplierSlug,
        externalEventId,
        eventType: String(payload.status ?? 'status-update'),
        signatureValid,
        status: 'RECEIVED',
        payload: (sanitizeForLog(payload) ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      logger.info('Duplicate supplier webhook ignored', { externalEventId });
      return { status: 200, body: { ok: true, duplicate: true } };
    }
    throw err;
  }

  if (!signatureValid) {
    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { status: 'REJECTED', error: 'Invalid or missing X-Supplier-Signature' },
    });
    logger.error('Supplier webhook signature verification failed', { supplierSlug });
    return { status: 400, body: { ok: false, error: 'Invalid webhook signature' } };
  }

  try {
    const supplierOrderId = String(payload.supplierOrderId ?? '');
    if (!supplierOrderId) throw new Error('Missing supplierOrderId in webhook payload');

    const so = await prisma.supplierOrder.findFirst({
      where: { OR: [{ supplierOrderId }, { id: supplierOrderId }] },
      include: { order: true },
    });
    if (!so) throw new Error(`Unknown supplier order: ${supplierOrderId}`);

    const update: SupplierStatusUpdate = {
      status: normalizeStatus(String(payload.status ?? '')),
      trackingNumber: strOrNull(payload.trackingNumber),
      carrier: strOrNull(payload.carrier),
      trackingUrl: strOrNull(payload.trackingUrl),
      message: strOrNull(payload.message),
      events: Array.isArray(payload.events)
        ? payload.events.slice(0, 50).map((e) => {
            const ev = e as Record<string, unknown>;
            return {
              status: String(ev.status ?? 'UPDATE'),
              message: strOrNull(ev.message),
              location: strOrNull(ev.location),
              eventAt: strOrNull(ev.eventAt),
            };
          })
        : undefined,
    };

    await applySupplierStatusUpdate(so, update);

    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { status: 'PROCESSED', processedAt: new Date(), orderId: so.orderId },
    });
    return { status: 200, body: { ok: true } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { status: 'FAILED', error: message.slice(0, 500) },
    });
    logger.error('Supplier webhook processing failed', { error: message });
    return { status: 422, body: { ok: false, error: message } };
  }
}

function normalizeStatus(raw: string): SupplierStatusUpdate['status'] {
  switch (raw.toUpperCase().replace(/-/g, '_')) {
    case 'ACCEPTED':
    case 'CONFIRMED':
      return 'ACCEPTED';
    case 'PROCESSING':
    case 'PACKING':
      return 'PROCESSING';
    case 'SHIPPED':
    case 'DISPATCHED':
    case 'IN_TRANSIT':
      return 'SHIPPED';
    case 'OUT_FOR_DELIVERY':
      return 'OUT_FOR_DELIVERY';
    case 'DELIVERED':
      return 'DELIVERED';
    case 'CANCELLED':
    case 'CANCELED':
      return 'CANCELLED';
    case 'REJECTED':
    case 'FAILED':
      return 'REJECTED';
    default:
      return 'UNKNOWN';
  }
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : null;
}
