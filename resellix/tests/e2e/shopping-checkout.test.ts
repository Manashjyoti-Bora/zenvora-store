import './env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import { toPaise } from '@/lib/money';

import { type CartLike } from './types';
import { HttpAgent, okData, pollUntil, uniqueEmail, waitForServer } from './http';
import { createFixtureUser, loginFixture } from './fixtures';

/**
 * E2E — browse → cart → coupon → checkout → TEST payment → auto fulfilment.
 *
 * Payments here use the built-in TEST provider (PAYMENTS_TEST_MODE=true, dev
 * server only). This is a *test* payment path, not a real gateway — the suite
 * asserts exactly that: provider === 'TEST'.
 *
 * Rate-limit budgets consumed by this file (per IP):
 * cart-add 60/10min → ~7; checkout 10/10min → 5; payments/create 30/10min → 1;
 * track 20/15min → 3. All within limits.
 */


interface ChargerInfo {
  productId: string;
  variantId: string | null;
  unitPricePaise: number;
  stock: number;
}

interface ShippingSettings {
  flatFeePaise: number;
  freeAbovePaise: number;
  codFeePaise: number;
}

let charger: ChargerInfo;
let shipping: ShippingSettings;

const agent = new HttpAgent(); // logged-in customer for the prepaid flow
const guestAgent = new HttpAgent(); // guest for the COD + tracking flow

let orderNumber: string;
let grandTotalPaise: number;

function validAddress(fullName: string) {
  return {
    fullName,
    phone: '9876543210',
    line1: '12 E2E Street',
    city: 'Guwahati',
    state: 'Assam',
    postalCode: '781001',
    country: 'IN',
  };
}

beforeAll(async () => {
  await waitForServer();

  const product = await prisma.product.findUnique({
    where: { slug: 'usb-c-fast-charger-65w' },
    include: { variants: { where: { isActive: true } } },
  });
  if (!product) throw new Error('E2E requires seeded catalog — run `npm run db:seed`');
  const variant = product.variants[0] ?? null;
  charger = {
    productId: product.id,
    variantId: variant?.id ?? null,
    unitPricePaise: variant?.sellingPrice ? toPaise(variant.sellingPrice) : toPaise(product.sellingPrice),
    stock: variant ? variant.stock : product.stock,
  };

  const setting = await prisma.setting.findUnique({ where: { key: 'store' } });
  const raw = (setting?.value ?? {}) as { shipping?: Partial<ShippingSettings> & { flatRatePaise?: number } };
  shipping = {
    flatFeePaise: raw.shipping?.flatRatePaise ?? raw.shipping?.flatFeePaise ?? 4900,
    freeAbovePaise: raw.shipping?.freeAbovePaise ?? 99900,
    codFeePaise: raw.shipping?.codFeePaise ?? 2000,
  };

  const shopper = await createFixtureUser('e2e-shop');
  const login = await loginFixture(agent, shopper);
  expect(login.status).toBe(200);
}, 180_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('cart', () => {
  it('adds an item and prices it from the SERVER catalog (client cannot set price)', async () => {
    const res = await agent.post('/api/cart', { productId: charger.productId, variantId: charger.variantId, quantity: 2 });
    expect(res.status).toBe(200);
    const view = okData<CartLike>(res);
    expect(view).toBeTruthy();
    expect(view!.itemCount).toBe(2);
    expect(view!.subtotalPaise).toBe(charger.unitPricePaise * 2);
    const line = view!.lines[0];
    expect(line!.unitPricePaise).toBe(charger.unitPricePaise); // DB selling price, not anything client-sent
  });

  it('rejects a negative quantity', async () => {
    const res = await agent.post('/api/cart', { productId: charger.productId, quantity: -1 });
    expect(res.status).toBe(400);
  });

  it('rejects quantity beyond available stock', async () => {
    const res = await agent.post('/api/cart', { productId: charger.productId, quantity: charger.stock + 900 });
    expect(res.status).toBe(400);
  });

  it('updates quantity via PATCH /api/cart/item', async () => {
    const view0 = okData<CartLike>(await agent.get('/api/cart'))!;
    const itemId = view0.lines[0]!.itemId;
    const res = await agent.patch('/api/cart/item', { itemId, quantity: 3 });
    expect(res.status).toBe(200);
    const view = okData<CartLike>(res);
    expect(view!.itemCount).toBe(3);
    expect(view!.subtotalPaise).toBe(charger.unitPricePaise * 3);
  });

  it('applies coupon WELCOME10 with discount = min(10%, ₹150 cap) computed server-side', async () => {
    const res = await agent.post('/api/cart/coupon', { code: 'WELCOME10' });
    expect(res.status).toBe(200);
    const view = okData<CartLike>(res);
    const subtotal = charger.unitPricePaise * 3;
    const expected = Math.min(Math.round(subtotal * 0.1), 15000);
    expect(view!.coupon?.code).toBe('WELCOME10');
    expect(view!.coupon?.discountPaise).toBe(expected);
  });

  it('rejects an invalid coupon code (no discount applied)', async () => {
    const res = await agent.post('/api/cart/coupon', { code: 'NOPE123' });
    if (res.status === 200) {
      const view = okData<CartLike>(res);
      expect(view!.coupon?.code).not.toBe('NOPE123');
      expect(view!.couponError).toBeTruthy();
    } else {
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    // Restore the valid coupon for the checkout test.
    const restore = await agent.post('/api/cart/coupon', { code: 'WELCOME10' });
    expect(restore.status).toBe(200);
  });
});

describe('checkout — prepaid + TEST payment + auto fulfilment', () => {
  const idempotencyKey = `e2e-key-${Date.now().toString(36)}`;

  it('creates a PENDING_PAYMENT order; totals match the server cart view exactly', async () => {
    const res = await agent.post('/api/checkout', {
      paymentMethod: 'PREPAID_GATEWAY',
      address: validAddress('Shopper'),
      idempotencyKey,
    });
    expect(res.status).toBe(201);
    const body = okData<{ orderNumber: string; grandTotalPaise: number; status: string; nextStep: string }>(res);
    expect(body?.orderNumber).toMatch(/^RX-\d{6}-[23456789A-HJ-NP-Z]{6}$/);
    orderNumber = body!.orderNumber;
    grandTotalPaise = body!.grandTotalPaise;
    expect(body!.status).toBe('PENDING_PAYMENT');
    expect(body!.nextStep).toMatch(/payment/i);

    // Server-computed total: subtotal − coupon + shipping (free above threshold).
    const subtotal = charger.unitPricePaise * 3;
    const discount = Math.min(Math.round(subtotal * 0.1), 15000);
    const afterDiscount = subtotal - discount;
    const ship = afterDiscount >= shipping.freeAbovePaise ? 0 : shipping.flatFeePaise;
    expect(grandTotalPaise).toBe(afterDiscount + ship);

    const dbOrder = await prisma.order.findUnique({ where: { orderNumber } });
    expect(dbOrder?.status).toBe('PENDING_PAYMENT');
    expect(dbOrder?.userId).toBeTruthy();
  });

  it('is idempotent: replaying the same key returns the SAME order (HTTP 200)', async () => {
    const res = await agent.post('/api/checkout', {
      paymentMethod: 'PREPAID_GATEWAY',
      address: validAddress('Shopper'),
      idempotencyKey,
    });
    expect(res.status).toBe(200);
    const body = okData<{ orderNumber: string }>(res);
    expect(body?.orderNumber).toBe(orderNumber);
  });

  it('rejects checkout with an invalid postal code', async () => {
    const res = await agent.post('/api/checkout', {
      paymentMethod: 'COD',
      address: { ...validAddress('Bad Pin'), postalCode: '12' },
    });
    expect(res.status).toBe(400);
  });

  it('creates a TEST payment order whose amount ALWAYS comes from the stored order', async () => {
    const res = await agent.post('/api/payments/create', { orderNumber });
    expect(res.status).toBe(200);
    const body = okData<{ mode: string; provider: string; providerOrderId: string; amountPaise: number }>(res);
    expect(body?.provider).toBe('TEST'); // honest: this is the test provider, never a real gateway
    expect(body?.amountPaise).toBe(grandTotalPaise);

    const dbPayment = await prisma.payment.findUnique({ where: { providerOrderId: body!.providerOrderId } });
    expect(dbPayment?.provider).toBe('TEST');
    expect(dbPayment?.status).toBe('CREATED');
  });

  it('simulated TEST payment success → order PAID → supplier order auto-created', async () => {
    const res = await agent.post('/api/payments/test/simulate', { orderNumber, outcome: 'success' });
    expect(res.status).toBe(200);
    const body = okData<{ status: string; orderStatus: string }>(res);
    expect(body?.status).toBe('PAID');

    // The fulfilment job runs in-process but asynchronously — poll.
    const paid = await pollUntil(async () => {
      const order = await prisma.order.findUnique({
        where: { orderNumber },
        include: { payments: true, supplierOrders: true },
      });
      if (!order || order.paymentStatus !== 'PAID') return null;
      if (['PENDING_PAYMENT', 'PAYMENT_FAILED'].includes(order.status)) return null;
      return order;
    }, 30_000, 750);

    expect(paid, 'order should leave PENDING_PAYMENT after successful payment').toBeTruthy();
    expect(paid!.payments.some((p) => p.provider === 'TEST' && ['PAID', 'CAPTURED'].includes(p.status))).toBe(true);

    const supplierOrder = await pollUntil(
      async () => prisma.supplierOrder.findFirst({ where: { orderId: paid!.id } }),
      30_000,
      750
    );
    expect(supplierOrder, 'demo supplier fulfilment should be queued automatically').toBeTruthy();
    expect(['QUEUED', 'SENT', 'ACCEPTED', 'SHIPPED', 'DELIVERED']).toContain(supplierOrder!.status);
  });
});

describe('checkout — COD (guest) + tracking', () => {
  let guestOrderNumber: string;
  const guestEmail = uniqueEmail('e2e-guest');

  it('guest can add to cart and place a COD order (confirmed immediately)', async () => {
    await guestAgent.get('/api/health');
    const add = await guestAgent.post('/api/cart', { productId: charger.productId, variantId: charger.variantId, quantity: 1 });
    expect(add.status).toBe(200);

    const res = await guestAgent.post('/api/checkout', {
      paymentMethod: 'COD',
      address: validAddress('Guest Buyer'),
      guest: { email: guestEmail, name: 'Guest Buyer', phone: '9876500000' },
    });
    expect(res.status).toBe(201);
    const body = okData<{ orderNumber: string; grandTotalPaise: number; status: string }>(res);
    guestOrderNumber = body!.orderNumber;

    const subtotal = charger.unitPricePaise;
    const ship = subtotal >= shipping.freeAbovePaise ? 0 : shipping.flatFeePaise;
    expect(body!.grandTotalPaise).toBe(subtotal + ship + shipping.codFeePaise); // COD fee included

    const dbOrder = await prisma.order.findUnique({ where: { orderNumber: guestOrderNumber } });
    expect(dbOrder?.paymentMethod).toBe('COD');
    expect(dbOrder?.guestEmail?.toLowerCase()).toBe(guestEmail);
    expect(['ORDER_CONFIRMED', 'SENT_TO_SUPPLIER', 'PROCESSING', 'SHIPPED']).toContain(dbOrder?.status);
  });

  it('tracks a guest order with orderNumber + email (both required)', async () => {
    const anon = new HttpAgent();
    await anon.get('/api/health');
    const ok = await anon.post('/api/track', { orderNumber: guestOrderNumber, email: guestEmail });
    expect(ok.status).toBe(200);
    const body = okData<{ orderNumber: string; status: string; items: unknown[] }>(ok);
    expect(body?.orderNumber).toBe(guestOrderNumber);
    expect(Array.isArray(body?.items)).toBe(true);
    expect(body!.items.length).toBe(1);
  });

  it('refuses tracking with the wrong email (uniform 404 — no enumeration)', async () => {
    const anon = new HttpAgent();
    await anon.get('/api/health');
    const res = await anon.post('/api/track', { orderNumber: guestOrderNumber, email: 'wrong@e2e.example' });
    expect(res.status).toBe(404);
  });
});
