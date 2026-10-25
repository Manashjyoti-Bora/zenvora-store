import './env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { HttpAgent, errCode, okData, waitForServer } from './http';
import { createFixtureUser, loginFixture } from './fixtures';

/**
 * E2E — customer data isolation on ORDER endpoints + oversized request bodies.
 *
 * Alice places a COD order; Bob (another customer) and an anonymous client must
 * not be able to read, cancel, return or pay for it through any public route.
 * (Address-book IDOR is covered in admin-authz.test.ts.)
 *
 * Rate-limit budgets consumed (per IP): checkout 10/10min → 1; cancel 10/30min
 * → 3; payments/create 30/10min → 2; cart-add 60/10min → 1.
 */
const alice = new HttpAgent();
const bob = new HttpAgent();
const anon = new HttpAgent();
let aliceEmail: string;
let orderNumber: string;

function address(fullName: string) {
  return {
    fullName,
    phone: '9876543210',
    line1: '7 Isolation Road',
    city: 'Guwahati',
    state: 'Assam',
    postalCode: '781001',
    country: 'IN',
  };
}

beforeAll(async () => {
  await waitForServer();
  const product = await prisma.product.findUnique({ where: { slug: 'usb-c-fast-charger-65w' } });
  if (!product) throw new Error('E2E requires seeded catalog — run `npm run db:seed`');

  const a = await createFixtureUser('e2e-iso-a');
  aliceEmail = a.email;
  expect((await loginFixture(alice, a)).status).toBe(200);
  const b = await createFixtureUser('e2e-iso-b');
  expect((await loginFixture(bob, b)).status).toBe(200);
  await anon.get('/api/health'); // prime CSRF cookie only

  const add = await alice.post('/api/cart', { productId: product.id, quantity: 1 });
  expect(add.status).toBe(200);
  const checkout = await alice.post('/api/checkout', {
    paymentMethod: 'COD',
    address: address('Alice Owner'),
    idempotencyKey: `e2e-iso-${Date.now().toString(36)}`,
  });
  expect(checkout.status).toBe(201);
  orderNumber = okData<{ orderNumber: string }>(checkout)!.orderNumber;
}, 180_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('another customer cannot act on Alice’s order', () => {
  it('POST /api/orders/:n/cancel → 403 and the order is untouched', async () => {
    const res = await bob.post(`/api/orders/${orderNumber}/cancel`, { reason: 'not mine' });
    expect(res.status).toBe(403);
    const row = await prisma.order.findUniqueOrThrow({ where: { orderNumber } });
    expect(row.status).not.toBe('CANCELLED');
  });

  it("POST /api/orders/:n/cancel with the owner's e-mail still → 403 (e-mail unlocks guest orders only)", async () => {
    const res = await bob.post(`/api/orders/${orderNumber}/cancel`, {
      reason: 'not mine',
      email: aliceEmail,
    });
    expect(res.status).toBe(403);
  });

  it('POST /api/orders/:n/return → 403', async () => {
    const res = await bob.post(`/api/orders/${orderNumber}/return`, { reason: 'not mine' });
    expect(res.status).toBe(403);
  });

  it('POST /api/payments/create for someone else’s order → 403', async () => {
    const res = await bob.post('/api/payments/create', { orderNumber });
    expect(res.status).toBe(403);
  });

  it('GET /account/orders/:n renders 404 for Bob (no leak via the page route)', async () => {
    const res = await bob.get(`/account/orders/${orderNumber}`);
    expect(res.status).toBe(404);
    expect(res.body).not.toContain('Alice Owner');
  });
});

describe('anonymous clients cannot act on a user-owned order', () => {
  it('cancel / payments → 403 (not 404: the number is valid, the caller is not)', async () => {
    const cancel = await anon.post(`/api/orders/${orderNumber}/cancel`, {
      reason: 'anon',
      email: aliceEmail,
    });
    expect(cancel.status).toBe(403);
    const pay = await anon.post('/api/payments/create', { orderNumber, email: aliceEmail });
    expect(pay.status).toBe(403);
  });

  it('GET /account/orders/:n redirects to login (no content)', async () => {
    const res = await anon.get(`/account/orders/${orderNumber}`);
    expect([302, 303, 307, 308]).toContain(res.status);
    expect(res.location() ?? '').toMatch(/login/);
  });
});

describe('oversized request bodies', () => {
  it('a >1 MB JSON body is rejected with 413 before any handler logic runs', async () => {
    const huge = JSON.stringify({ reason: 'x'.repeat(1_100_000) });
    const res = await alice.post(`/api/orders/${orderNumber}/cancel`, undefined, { rawBody: huge });
    expect(res.status).toBe(413);
    expect(errCode(res) ?? '').toMatch(/PAYLOAD_TOO_LARGE|TOO_LARGE/i);
    const row = await prisma.order.findUniqueOrThrow({ where: { orderNumber } });
    expect(row.status).not.toBe('CANCELLED');
  });
});

describe('the owner keeps full access', () => {
  it('Alice can read her order page and cancel her own order', async () => {
    const page = await alice.get(`/account/orders/${orderNumber}`);
    expect(page.status).toBe(200);
    const res = await alice.post(`/api/orders/${orderNumber}/cancel`, {
      reason: 'changed my mind',
    });
    expect(res.status).toBe(200);
    const row = await prisma.order.findUniqueOrThrow({ where: { orderNumber } });
    expect(row.status).toBe('CANCELLED');
  });
});
