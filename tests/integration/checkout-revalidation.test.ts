import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { toPaise } from '@/lib/money';
import { addToCart } from '@/lib/cart/service';
import { createOrderFromCart } from '@/lib/orders/create';
import { ApiError } from '@/lib/errors';
import { getSettings, updateSettings, type StoreSettings } from '@/lib/settings';
import { clearCookieJar } from './mock-headers';
import {
  TEST_ADDRESS,
  cleanupTestData,
  createTestProduct,
  createTestUser,
  unique,
} from './fixtures';

/**
 * Checkout must re-derive price, availability and stock from the catalogue at
 * order time — never from the cart snapshot — and must create at most one
 * order per cart no matter how the request is repeated.
 */
describe('checkout re-validation against the live catalogue', () => {
  let savedShipping: StoreSettings['shipping'];
  let userId: string;
  let userEmail: string;

  const sessionUser = () => ({
    id: userId,
    email: userEmail,
    name: 'Revalidation Tester',
    role: 'CUSTOMER' as const,
    status: 'ACTIVE' as const,
  });

  beforeAll(async () => {
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
    const user = await createTestUser();
    userId = user.id;
    userEmail = user.email;
  });

  afterAll(async () => {
    await updateSettings({ shipping: savedShipping });
    await cleanupTestData();
  });

  beforeEach(async () => {
    clearCookieJar();
    // Fresh cart per test: drop any cart left over (converted or not).
    await prisma.cart.deleteMany({ where: { userId } });
  });

  it('charges the CURRENT catalogue price when it changed after the item was added', async () => {
    const product = await createTestProduct({ sellingPrice: '250.00', stock: 10 });
    const view = await addToCart({ userId, productId: product.id, quantity: 1 });

    const cartItem = await prisma.cartItem.findFirstOrThrow({ where: { cartId: view.cartId } });
    expect(toPaise(cartItem.unitPriceAtAdd)).toBe(25_000);

    // Admin re-prices the product while it sits in the cart.
    await prisma.product.update({
      where: { id: product.id },
      data: { sellingPrice: '300.00', fixedPrice: '300.00' },
    });

    const result = await createOrderFromCart({
      cartId: view.cartId,
      user: sessionUser(),
      address: TEST_ADDRESS,
      paymentMethod: 'PREPAID_GATEWAY',
      idempotencyKey: unique('itest-price'),
    });
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: result.orderId },
      include: { items: true },
    });
    expect(toPaise(order.items[0]!.unitPrice)).toBe(30_000);
    expect(toPaise(order.subtotal)).toBe(30_000);
    // 300 < 999 free-shipping threshold → flat shipping applies.
    expect(result.grandTotalPaise).toBe(30_000 + 4_900);
  });

  it('refuses the order (and leaves stock untouched) when stock dropped below the cart quantity', async () => {
    const product = await createTestProduct({ stock: 10 });
    const view = await addToCart({ userId, productId: product.id, quantity: 3 });

    // Someone else bought most of it / admin corrected the count.
    await prisma.product.update({ where: { id: product.id }, data: { stock: 2 } });

    await expect(
      createOrderFromCart({
        cartId: view.cartId,
        user: sessionUser(),
        address: TEST_ADDRESS,
        paymentMethod: 'COD',
        idempotencyKey: unique('itest-stock'),
      })
    ).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.statusCode === 409);

    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.stock).toBe(2);
    const cart = await prisma.cart.findUniqueOrThrow({ where: { id: view.cartId } });
    expect(cart.convertedOrderId).toBeNull();
    expect(await prisma.order.count({ where: { items: { some: { productId: product.id } } } })).toBe(0);
  });

  it('refuses the order when the product was unpublished after it was added', async () => {
    const product = await createTestProduct({ stock: 10 });
    const view = await addToCart({ userId, productId: product.id, quantity: 1 });
    await prisma.product.update({ where: { id: product.id }, data: { status: 'ARCHIVED' } });

    await expect(
      createOrderFromCart({
        cartId: view.cartId,
        user: sessionUser(),
        address: TEST_ADDRESS,
        paymentMethod: 'COD',
        idempotencyKey: unique('itest-archived'),
      })
    ).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.statusCode === 409);
    expect(await prisma.order.count({ where: { items: { some: { productId: product.id } } } })).toBe(0);
  });

  it('creates exactly ONE order when the same cart is submitted concurrently with different keys', async () => {
    const product = await createTestProduct({ stock: 10 });
    const view = await addToCart({ userId, productId: product.id, quantity: 2 });

    // Double-tap / client retry where the idempotency key was regenerated.
    const attempts = await Promise.allSettled(
      [1, 2, 3].map((n) =>
        createOrderFromCart({
          cartId: view.cartId,
          user: sessionUser(),
          address: TEST_ADDRESS,
          paymentMethod: 'COD',
          idempotencyKey: unique(`itest-race-${n}`),
        })
      )
    );

    const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
    const rejected = attempts.filter((a) => a.status === 'rejected');
    // Every attempt either returns the single order or a clean API error — no crashes.
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ApiError);
    }
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const orders = await prisma.order.findMany({
      where: { items: { some: { productId: product.id } } },
    });
    expect(orders).toHaveLength(1);

    const ids = new Set(
      fulfilled.map((f) => (f as PromiseFulfilledResult<{ orderId: string }>).value.orderId)
    );
    expect(ids.size).toBe(1);

    // Stock decremented exactly once.
    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.stock).toBe(8);
  });

  it('a second submission of an already-converted cart returns the same order, not a new one', async () => {
    const product = await createTestProduct({ stock: 10 });
    const view = await addToCart({ userId, productId: product.id, quantity: 1 });
    const first = await createOrderFromCart({
      cartId: view.cartId,
      user: sessionUser(),
      address: TEST_ADDRESS,
      paymentMethod: 'COD',
      idempotencyKey: unique('itest-seq-a'),
    });
    const second = await createOrderFromCart({
      cartId: view.cartId,
      user: sessionUser(),
      address: TEST_ADDRESS,
      paymentMethod: 'COD',
      idempotencyKey: unique('itest-seq-b'),
    });
    expect(second.alreadyExisted).toBe(true);
    expect(second.orderId).toBe(first.orderId);
    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.stock).toBe(9);
  });
});
