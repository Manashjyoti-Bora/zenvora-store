import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Simulate a production-like NONE selection without changing the shared test
// process environment. The rest of the real order/cart/database stack remains.
vi.mock('@/lib/payments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/payments')>();
  return {
    ...actual,
    describePaymentProvider: () => ({ kind: 'NONE', label: 'Not configured', isTest: false }),
  };
});

import { prisma } from '@/lib/db';
import { addToCart } from '@/lib/cart/service';
import { createOrderFromCart } from '@/lib/orders/create';
import { ApiError } from '@/lib/errors';
import { getSettings, updateSettings, type StoreSettings } from '@/lib/settings';
import { cleanupTestData, createTestProduct, createTestUser, TEST_ADDRESS } from './fixtures';

describe('checkout provider availability fail-closed (isolated database)', () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let productId: string;
  let savedShipping: StoreSettings['shipping'];

  beforeAll(async () => {
    await cleanupTestData();
    savedShipping = (await getSettings()).shipping;
    await updateSettings({ shipping: { ...savedShipping, codEnabled: true } });
    user = await createTestUser();
    productId = (await createTestProduct({ stock: 5, sellingPrice: '125.00' })).id;
  });

  afterAll(async () => {
    await updateSettings({ shipping: savedShipping });
    await cleanupTestData();
  });

  function sessionUser() {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: 'CUSTOMER' as const,
      status: 'ACTIVE' as const,
    };
  }

  it('rejects a direct NEW prepaid order with 503 and leaves the cart recoverable', async () => {
    const cart = await addToCart({ userId: user.id, productId, quantity: 1 });
    let error: unknown;
    try {
      await createOrderFromCart({
        cartId: cart.cartId,
        user: sessionUser(),
        address: TEST_ADDRESS,
        paymentMethod: 'PREPAID_GATEWAY',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).statusCode).toBe(503);
    expect((error as ApiError).code).toBe('PAYMENTS_NOT_CONFIGURED');
    expect(await prisma.order.count({ where: { userId: user.id } })).toBe(0);
    const unchanged = await prisma.cart.findUniqueOrThrow({
      where: { id: cart.cartId },
      include: { items: true },
    });
    expect(unchanged.convertedOrderId).toBeNull();
    expect(unchanged.items).toHaveLength(1);
  });

  it('still permits COD when no online provider exists', async () => {
    const cart = await addToCart({ userId: user.id, productId, quantity: 1 });
    const result = await createOrderFromCart({
      cartId: cart.cartId,
      user: sessionUser(),
      address: TEST_ADDRESS,
      paymentMethod: 'COD',
    });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: result.orderId } });
    expect(order.paymentMethod).toBe('COD');
    expect(order.paymentStatus).toBe('COD_PENDING');
  });

  it('preserves idempotent recovery of an existing order after provider disablement', async () => {
    const idempotencyKey = `itest-disabled-${Date.now()}`;
    const existing = await prisma.order.create({
      data: {
        orderNumber: `ITEST-DISABLED-${Date.now()}`,
        idempotencyKey,
        userId: user.id,
        paymentMethod: 'PREPAID_GATEWAY',
        paymentStatus: 'PENDING',
        subtotal: '1.00',
        grandTotal: '1.00',
        shippingAddress: { isolated: true },
      },
    });

    const recovered = await createOrderFromCart({
      cartId: 'not-read-because-idempotency-resolves-first',
      user: sessionUser(),
      address: TEST_ADDRESS,
      paymentMethod: 'PREPAID_GATEWAY',
      idempotencyKey,
    });
    expect(recovered.orderId).toBe(existing.id);
    expect(recovered.alreadyExisted).toBe(true);
  });
});
