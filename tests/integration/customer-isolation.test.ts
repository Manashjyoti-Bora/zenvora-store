import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { addToCart } from '@/lib/cart/service';
import { createOrderFromCart } from '@/lib/orders/create';
import { findOrderForAccess } from '@/lib/orders/access';
import { ApiError } from '@/lib/errors';
import { getSettings, updateSettings, type StoreSettings } from '@/lib/settings';
import type { SessionUser } from '@/lib/auth/session';
import { clearCookieJar } from './mock-headers';
import {
  TEST_ADDRESS,
  cleanupTestData,
  createTestProduct,
  createTestUser,
  testEmail,
  unique,
} from './fixtures';

/**
 * Customer data isolation (anti-IDOR) at the access-control helper used by
 * every customer-facing order endpoint (cancel, return, payments/create,
 * payments/verify, account order page). HTTP-level checks live in e2e.
 */
describe('customer data isolation — orders', () => {
  let savedShipping: StoreSettings['shipping'];
  let alice: SessionUser;
  let bob: SessionUser;
  let staff: SessionUser;
  let aliceOrderNumber: string;
  let guestOrderNumber: string;
  const guestEmail = testEmail('guest-iso');

  const asSession = (u: { id: string; email: string; name: string }, role: SessionUser['role']) =>
    ({ id: u.id, email: u.email, name: u.name, role, status: 'ACTIVE' }) as SessionUser;

  const expectApiError = (status: number) => (e: unknown) =>
    e instanceof ApiError && e.statusCode === status;

  beforeAll(async () => {
    clearCookieJar();
    await cleanupTestData();
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

    alice = asSession(await createTestUser({ name: 'Alice' }), 'CUSTOMER');
    bob = asSession(await createTestUser({ name: 'Bob' }), 'CUSTOMER');
    staff = asSession(await createTestUser({ role: 'STAFF', name: 'Staff' }), 'STAFF');

    const product = await createTestProduct({ stock: 20 });

    const aliceCart = await addToCart({ userId: alice.id, productId: product.id, quantity: 1 });
    aliceOrderNumber = (
      await createOrderFromCart({
        cartId: aliceCart.cartId,
        user: alice,
        address: TEST_ADDRESS,
        paymentMethod: 'COD',
        idempotencyKey: unique('itest-iso-alice'),
      })
    ).orderNumber;

    // Guest order: separate anonymous cart (no user id).
    const guestCart = await addToCart({ userId: null, productId: product.id, quantity: 1 });
    guestOrderNumber = (
      await createOrderFromCart({
        cartId: guestCart.cartId,
        user: null,
        guest: { email: guestEmail, name: 'Guest Shopper', phone: '9876543210' },
        address: TEST_ADDRESS,
        paymentMethod: 'COD',
        idempotencyKey: unique('itest-iso-guest'),
      })
    ).orderNumber;
  });

  afterAll(async () => {
    await updateSettings({ shipping: savedShipping });
    await cleanupTestData();
  });

  it('the owner can read their own order', async () => {
    const order = await findOrderForAccess(aliceOrderNumber, alice, null);
    expect(order.userId).toBe(alice.id);
  });

  it('another logged-in customer gets 403 (order exists, but is not theirs)', async () => {
    await expect(findOrderForAccess(aliceOrderNumber, bob, null)).rejects.toSatisfy(
      expectApiError(403)
    );
  });

  it("another customer cannot smuggle access by passing the owner's e-mail", async () => {
    // Email-based access is for guest orders only; a user-owned order must
    // never be unlocked by e-mail (which is far easier to guess than a session).
    await expect(findOrderForAccess(aliceOrderNumber, bob, alice.email)).rejects.toSatisfy(
      expectApiError(403)
    );
  });

  it('anonymous access to a user-owned order is refused even with the e-mail', async () => {
    await expect(findOrderForAccess(aliceOrderNumber, null, alice.email)).rejects.toSatisfy(
      expectApiError(403)
    );
    await expect(findOrderForAccess(aliceOrderNumber, null, null)).rejects.toSatisfy(
      expectApiError(403)
    );
  });

  it('guest orders require the exact checkout e-mail (case-insensitive) and nothing else', async () => {
    const ok = await findOrderForAccess(guestOrderNumber, null, guestEmail.toUpperCase());
    expect(ok.orderNumber).toBe(guestOrderNumber);
    await expect(findOrderForAccess(guestOrderNumber, null, 'other@itest.local')).rejects.toSatisfy(
      expectApiError(403)
    );
    await expect(findOrderForAccess(guestOrderNumber, null, null)).rejects.toSatisfy(
      expectApiError(403)
    );
    // A logged-in customer does not inherit access to guest orders either.
    await expect(findOrderForAccess(guestOrderNumber, bob, null)).rejects.toSatisfy(
      expectApiError(403)
    );
  });

  it('staff/admin can read any order (back-office support path)', async () => {
    const a = await findOrderForAccess(aliceOrderNumber, staff, null);
    const g = await findOrderForAccess(guestOrderNumber, staff, null);
    expect(a.orderNumber).toBe(aliceOrderNumber);
    expect(g.orderNumber).toBe(guestOrderNumber);
  });

  it('unknown order numbers are a 404, regardless of who asks', async () => {
    await expect(findOrderForAccess('RX-000000-NOPE00', alice, null)).rejects.toSatisfy(
      expectApiError(404)
    );
  });

  it('account order listing is scoped by userId — Bob sees none of Alice’s orders', async () => {
    // Mirrors the `where: { userId: user.id }` used by /account and /account/orders.
    const bobOrders = await prisma.order.findMany({ where: { userId: bob.id } });
    expect(bobOrders).toHaveLength(0);
    const aliceOrders = await prisma.order.findMany({ where: { userId: alice.id } });
    expect(aliceOrders.map((o) => o.orderNumber)).toContain(aliceOrderNumber);
    expect(aliceOrders.map((o) => o.orderNumber)).not.toContain(guestOrderNumber);
  });
});
