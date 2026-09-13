import './env';
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';

import { HttpAgent, waitForServer } from './http';

/**
 * E2E — spoofing resistance on the machine-to-machine endpoints.
 *
 * These routes are intentionally CSRF/cookie-exempt; their ONLY authenticity
 * proof is an HMAC signature (webhooks) or a bearer secret (cron). This spec
 * proves forged requests are rejected, logged as REJECTED, and that duplicate
 * deliveries are idempotent (no double-processing side effects).
 */

const agent = new HttpAgent();

// Webhook deliveries dedupe on (provider, externalEventId) — without an eventId
// the raw-body hash is used, so bodies must be unique PER RUN or replays of a
// previous run's fixture would be (correctly!) swallowed as duplicates.
const NONCE = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const supplierSecret = process.env.SUPPLIER_WEBHOOK_SECRET ?? '';
const razorpaySecret = process.env.RAZORPAY_WEBHOOK_SECRET ?? '';
const cronSecret = process.env.CRON_SECRET ?? '';

function sign(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

beforeAll(async () => {
  await waitForServer();
  if (!supplierSecret) throw new Error('SUPPLIER_WEBHOOK_SECRET missing from .env — cannot run webhook security E2E');
  if (!cronSecret) throw new Error('CRON_SECRET missing from .env — cannot run cron security E2E');
}, 180_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Razorpay payment webhook', () => {
  const body = JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: `pay_E2Eforged_${NONCE}`, amount: 100000, status: 'captured' } } },
  });

  it('rejects a forged signature — also when the webhook secret is not configured', async () => {
    const res = await agent.post('/api/payments/webhook', undefined, {
      rawBody: body,
      headers: { 'x-razorpay-signature': 'deadbeef'.repeat(8) },
      csrf: false,
      cookies: false,
    });
    // With the secret configured: signature mismatch → 400 + REJECTED event.
    // Without it (RAZORPAY_WEBHOOK_SECRET unset — external blocker): validation
    // can never pass, so the endpoint must still refuse (400/503) and never
    // pretend a payment was captured.
    expect([400, 503]).toContain(res.status);
    expect(res.json<{ ok?: boolean }>()?.ok).toBe(false);
    if (razorpaySecret) {
      const rejected = await prisma.webhookEvent.findFirst({
        where: { source: 'PAYMENT', status: 'REJECTED' },
        orderBy: { receivedAt: 'desc' },
      });
      expect(rejected?.signatureValid).toBe(false);
    }
  });

  it('never marks a forged payment as captured', async () => {
    const forged = await prisma.payment.findFirst({ where: { providerOrderId: { startsWith: 'pay_E2Eforged_' } } });
    expect(forged).toBeNull();
  });
});

describe('supplier webhook (HMAC-SHA256 over raw body)', () => {
  it('rejects a bad signature with 400 and stores a REJECTED event', async () => {
    const body = JSON.stringify({ supplierSlug: 'demo-supplier', supplierOrderId: `E2E-FORGED-${NONCE}`, status: 'SHIPPED' });
    const res = await agent.post('/api/suppliers/webhook', undefined, {
      rawBody: body,
      headers: { 'x-supplier-signature': 'forged-signature-value' },
      csrf: false,
      cookies: false,
    });
    expect(res.status).toBe(400);
    expect(res.json<{ ok?: boolean }>()?.ok).toBe(false);

    const rejected = await prisma.webhookEvent.findFirst({
      where: { source: 'SUPPLIER', status: 'REJECTED' },
      orderBy: { receivedAt: 'desc' },
    });
    expect(rejected).toBeTruthy();
    expect(rejected?.signatureValid).toBe(false);
  });

  it('rejects a MISSING signature with 400', async () => {
    const body = JSON.stringify({ supplierSlug: 'demo-supplier', supplierOrderId: `E2E-FORGED-${NONCE}-NOSIG`, status: 'SHIPPED' });
    const res = await agent.post('/api/suppliers/webhook', undefined, { rawBody: body, csrf: false, cookies: false });
    expect(res.status).toBe(400);
  });

  it('accepts a VALID signature but fails business validation cleanly for an unknown order (422, not 500)', async () => {
    const body = JSON.stringify({ supplierSlug: 'demo-supplier', supplierOrderId: `E2E-UNKNOWN-${NONCE}`, status: 'SHIPPED' });
    const res = await agent.post('/api/suppliers/webhook', undefined, {
      rawBody: body,
      headers: { 'x-supplier-signature': sign(body, supplierSecret) },
      csrf: false,
      cookies: false,
    });
    expect(res.status).toBe(422);

    const failed = await prisma.webhookEvent.findFirst({
      where: { source: 'SUPPLIER', status: 'FAILED' },
      orderBy: { receivedAt: 'desc' },
    });
    expect(failed?.signatureValid).toBe(true); // signature OK, business rule failed — the two checks are separate
  });

  it('is idempotent: exact replay of a delivery returns duplicate=true without re-processing', async () => {
    const body = JSON.stringify({ supplierSlug: 'demo-supplier', supplierOrderId: `E2E-REPLAY-${NONCE}`, status: 'SHIPPED' });
    // First delivery: valid signature, unknown order → 422 FAILED (recorded once).
    const firstDelivery = await agent.post('/api/suppliers/webhook', undefined, {
      rawBody: body,
      headers: { 'x-supplier-signature': sign(body, supplierSecret) },
      csrf: false,
      cookies: false,
    });
    expect(firstDelivery.status).toBe(422);

    // Exact replay (same body hash ⇒ same externalEventId) → duplicate.
    const replay = await agent.post('/api/suppliers/webhook', undefined, {
      rawBody: body,
      headers: { 'x-supplier-signature': sign(body, supplierSecret) },
      csrf: false,
      cookies: false,
    });
    expect(replay.status).toBe(200);
    expect(replay.json<{ duplicate?: boolean }>()?.duplicate).toBe(true);

    // Dedupe key: no payload eventId ⇒ sha256(rawBody).slice(0, 32).
    const expectedEventId = crypto.createHash('sha256').update(body).digest('hex').slice(0, 32);
    const events = await prisma.webhookEvent.count({
      where: { source: 'SUPPLIER', provider: 'demo-supplier', externalEventId: expectedEventId },
    });
    // Exactly one stored event despite two deliveries (unique provider+externalEventId).
    expect(events).toBe(1);
  });

  it('does not 500 on a garbage body with a garbage signature', async () => {
    const res = await agent.post('/api/suppliers/webhook', undefined, {
      rawBody: `{{{not-json-${NONCE}`,
      headers: { 'x-supplier-signature': 'garbage' },
      csrf: false,
      cookies: false,
    });
    expect(res.status).toBe(400);
  });
});

describe('cron endpoint (CRON_SECRET bearer)', () => {
  it('rejects anonymous calls with 401', async () => {
    const res = await agent.post('/api/cron/jobs', undefined, { csrf: false, cookies: false });
    expect(res.status).toBe(401);
  });

  it('rejects a wrong secret with 401 (timing-safe compare)', async () => {
    const res = await agent.post('/api/cron/jobs', undefined, {
      headers: { authorization: 'Bearer definitely-the-wrong-secret' },
      csrf: false,
      cookies: false,
    });
    expect(res.status).toBe(401);
  });

  it('accepts the correct secret from .env and processes due jobs', async () => {
    const res = await agent.post('/api/cron/jobs', undefined, {
      headers: { authorization: `Bearer ${cronSecret}` },
      csrf: false,
      cookies: false,
    });
    expect(res.status).toBe(200);
    const body = res.json<{ ok?: boolean }>();
    expect(body?.ok).toBe(true);
  });
});
