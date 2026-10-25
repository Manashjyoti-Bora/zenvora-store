import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { toPaise } from '@/lib/money';
import { addToCart } from '@/lib/cart/service';
import { createOrderFromCart } from '@/lib/orders/create';
import { getSettings, updateSettings, type StoreSettings } from '@/lib/settings';
import { handleRazorpayWebhook } from '@/lib/payments/webhook';
import { clearCookieJar } from './mock-headers';
import {
  TEST_ADDRESS,
  cleanupTestData,
  createTestProduct,
  createTestUser,
  unique,
} from './fixtures';

// Test-only HMAC secret so the handler's signature validation runs for real.
// No gateway calls are made: the handler only verifies the signature and reads
// our own Payment row — exactly like a production webhook delivery.
vi.mock('@/lib/env', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/env')>();
  return {
    ...mod,
    env: { ...mod.env, RAZORPAY_WEBHOOK_SECRET: 'itest-webhook-secret-not-a-real-credential' },
  };
});
const WEBHOOK_SECRET = 'itest-webhook-secret-not-a-real-credential';

function sign(raw: string, secret = WEBHOOK_SECRET): string {
  return crypto.createHmac('sha256', secret).update(raw).digest('hex');
}

function capturedEvent(providerOrderId: string, amountPaise: number, paymentId: string) {
  return JSON.stringify({
    entity: 'event',
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: paymentId,
          entity: 'payment',
          order_id: providerOrderId,
          amount: amountPaise,
          currency: 'INR',
          status: 'captured',
          method: 'upi',
        },
      },
    },
  });
}

/**
 * Razorpay webhook handler: replay-safe, signature-enforced, amount-checked.
 * (The HTTP-level supplier-webhook replay is covered in e2e; this exercises the
 * payment handler directly, including the state it leaves in WebhookEvent.)
 */
describe('Razorpay webhook replay / tamper protection', () => {
  let savedShipping: StoreSettings['shipping'];
  let orderId: string;
  let orderNumber: string;
  let grandTotalPaise: number;
  const providerOrderId = unique('order_itest');

  const cleanupWebhookEvents = () =>
    prisma.webhookEvent.deleteMany({ where: { externalEventId: { startsWith: 'evt_itest' } } });

  beforeAll(async () => {
    clearCookieJar();
    await cleanupTestData();
    await cleanupWebhookEvents();
    savedShipping = (await getSettings()).shipping;
    await updateSettings({
      shipping: {
        flatRatePaise: 4900,
        freeAbovePaise: 99900,
        codEnabled: true,
        codFeePaise: 2000,
        estimatedDaysMin: 3,
        estimatedDaysMax: 7,
      },
    });

    const user = await createTestUser();
    const product = await createTestProduct({ sellingPrice: '499.00', stock: 5 });
    const view = await addToCart({ userId: user.id, productId: product.id, quantity: 1 });
    const result = await createOrderFromCart({
      cartId: view.cartId,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: 'CUSTOMER',
        status: 'ACTIVE',
      },
      address: TEST_ADDRESS,
      paymentMethod: 'PREPAID_GATEWAY',
      idempotencyKey: unique('itest-webhook'),
    });
    orderId = result.orderId;
    orderNumber = result.orderNumber;
    grandTotalPaise = result.grandTotalPaise;

    // The row the gateway adapter would have created when the checkout opened
    // a Razorpay order (provider order id ↔ our order).
    await prisma.payment.create({
      data: {
        orderId,
        provider: 'RAZORPAY',
        providerOrderId,
        amount: (grandTotalPaise / 100).toFixed(2),
        currency: 'INR',
        status: 'CREATED',
      },
    });
  });

  afterAll(async () => {
    await updateSettings({ shipping: savedShipping });
    await cleanupWebhookEvents();
    await cleanupTestData();
  });

  it('rejects a tampered/incorrectly signed delivery and records it as REJECTED', async () => {
    const raw = capturedEvent(providerOrderId, grandTotalPaise, 'pay_itest_bad');
    const res = await handleRazorpayWebhook(raw, sign(raw, 'wrong-secret'), 'evt_itest_badsig');
    expect(res.status).toBe(400);

    const evt = await prisma.webhookEvent.findUnique({
      where: { provider_externalEventId: { provider: 'RAZORPAY', externalEventId: 'evt_itest_badsig' } },
    });
    expect(evt?.status).toBe('REJECTED');
    expect(evt?.signatureValid).toBe(false);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe('PENDING');
  });

  it('rejects a correctly signed delivery whose amount does not match the order total', async () => {
    const raw = capturedEvent(providerOrderId, grandTotalPaise - 100, 'pay_itest_short');
    const res = await handleRazorpayWebhook(raw, sign(raw), 'evt_itest_amount');
    // Signature was valid, so the delivery is acknowledged — but nothing is paid.
    expect(res.status).toBe(200);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe('PENDING');
    expect(order.status).toBe('PENDING_PAYMENT');
    const payment = await prisma.payment.findUniqueOrThrow({ where: { providerOrderId } });
    expect(payment.status).toBe('CREATED');
    expect(
      await prisma.orderEvent.count({ where: { orderId, type: 'PAYMENT_AMOUNT_MISMATCH' } })
    ).toBe(1);
  });

  it('confirms the order on a valid payment.captured delivery', async () => {
    const raw = capturedEvent(providerOrderId, grandTotalPaise, 'pay_itest_ok');
    const res = await handleRazorpayWebhook(raw, sign(raw), 'evt_itest_ok');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, handled: true });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.paymentStatus).toBe('PAID');
    expect(order.status).not.toBe('PENDING_PAYMENT');
    const payment = await prisma.payment.findUniqueOrThrow({ where: { providerOrderId } });
    expect(payment.status).toBe('PAID');
    expect(toPaise(payment.amount)).toBe(grandTotalPaise);

    const evt = await prisma.webhookEvent.findUniqueOrThrow({
      where: { provider_externalEventId: { provider: 'RAZORPAY', externalEventId: 'evt_itest_ok' } },
    });
    expect(evt.status).toBe('PROCESSED');
    expect(evt.orderId).toBe(orderId);
  });

  it('replaying the same event id is acknowledged as a duplicate and changes nothing', async () => {
    // Note: after confirmation the fulfilment pipeline may advance the order
    // (ORDER_CONFIRMED → SENT_TO_SUPPLIER) in the background, so we assert on
    // payment state and payment-related events, not on the exact status.
    const before = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const paymentEventsBefore = await prisma.orderEvent.count({
      where: { orderId, type: { startsWith: 'PAYMENT_' } },
    });

    const raw = capturedEvent(providerOrderId, grandTotalPaise, 'pay_itest_ok');
    const res = await handleRazorpayWebhook(raw, sign(raw), 'evt_itest_ok');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, duplicate: true });

    const after = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(after.paymentStatus).toBe('PAID');
    expect(after.paidAt?.getTime()).toBe(before.paidAt?.getTime());
    expect(after.status).not.toBe('PENDING_PAYMENT');
    expect(
      await prisma.orderEvent.count({ where: { orderId, type: { startsWith: 'PAYMENT_' } } })
    ).toBe(paymentEventsBefore);
    expect(
      await prisma.webhookEvent.count({
        where: { provider: 'RAZORPAY', externalEventId: 'evt_itest_ok' },
      })
    ).toBe(1);
  });

  it('a re-delivery under a NEW event id for an already-paid order is idempotent too', async () => {
    const before = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const raw = capturedEvent(providerOrderId, grandTotalPaise, 'pay_itest_ok');
    const res = await handleRazorpayWebhook(raw, sign(raw), 'evt_itest_ok_again');
    expect(res.status).toBe(200);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(after.paymentStatus).toBe('PAID');
    expect(after.paidAt?.getTime()).toBe(before.paidAt?.getTime());
    expect(after.status).not.toBe('PENDING_PAYMENT');
    expect(await prisma.payment.count({ where: { orderId, status: 'PAID' } })).toBe(1);
    // Sanity: the order we have been asserting on is the one we created.
    expect(after.orderNumber).toBe(orderNumber);
  });
});
