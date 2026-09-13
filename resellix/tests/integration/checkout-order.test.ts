import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { toPaise } from '@/lib/money';
import { registerUser } from '@/lib/auth/service';
import { addToCart } from '@/lib/cart/service';
import { createOrderFromCart } from '@/lib/orders/create';
import { confirmCodOrder, markCodCollected } from '@/lib/payments/confirm';
import { updateSettings } from '@/lib/settings';
import { clearCookieJar } from './mock-headers';
import {
  cleanupTestData,
  createTestProduct,
  createTestCoupon,
  createTestSupplier,
  testEmail,
  TEST_ADDRESS,
} from './fixtures';

describe('checkout → order creation (the money-critical path)', () => {
  let userId: string;
  let userEmail: string;
  let productId: string;
  let supplierId: string;

  beforeAll(async () => {
    await cleanupTestData();
    // deterministic shipping/COD settings for exact total assertions
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
    const supplier = await createTestSupplier();
    supplierId = supplier.id;
    const product = await createTestProduct({
      name: 'Itest Checkout Product',
      stock: 10,
      sellingPrice: '250.00',
      supplierCost: '100.00',
      supplierShippingCost: '0.00',
    });
    productId = product.id;
    await prisma.product.update({ where: { id: productId }, data: { supplierId } });

    const user = await registerUser({
      email: testEmail('checkout'),
      password: 'Str0ng!Passphrase',
      name: 'Checkout Tester',
    });
    userId = user.user.id;
    userEmail = user.user.email;
  });

  afterAll(async () => {
    await updateSettings({
      shipping: { flatRatePaise: 4900, freeAbovePaise: 99900, codEnabled: false, codFeePaise: 0 },
    });
    await cleanupTestData();
  });

  beforeEach(() => {
    clearCookieJar();
  });

  it('creates a prepaid order with exact paise totals and frozen snapshots', async () => {
    const view = await addToCart({ userId, productId, quantity: 2 });
    const result = await createOrderFromCart({
      cartId: view.cartId,
      user: {
        id: userId,
        email: userEmail,
        name: 'Checkout Tester',
        role: 'CUSTOMER',
        status: 'ACTIVE',
      },
      address: TEST_ADDRESS,
      paymentMethod: 'PREPAID_GATEWAY',
      idempotencyKey: 'itest-key-prepaid-1',
    });

    expect(result.alreadyExisted).toBe(false);
    expect(result.status).toBe('PENDING_PAYMENT');
    expect(result.orderNumber).toMatch(/^RX-\d{6}-[23456789A-HJ-NP-Z]{6}$/);
    // 2 × ₹250 + ₹49 shipping (below ₹999 free-shipping threshold), no COD fee
    expect(result.grandTotalPaise).toBe(50_000 + 4_900);

    const order = await prisma.order.findUnique({
      where: { id: result.orderId },
      include: { items: true, events: true },
    });
    expect(order).not.toBeNull();
    expect(toPaise(order!.subtotal)).toBe(50_000);
    expect(toPaise(order!.shippingTotal)).toBe(4_900);
    expect(toPaise(order!.grandTotal)).toBe(54_900);
    expect(order!.paymentStatus).toBe('PENDING');

    // frozen line snapshots (audit-proof costs & price at order time)
    const item = order!.items[0];
    expect(toPaise(item.unitPrice)).toBe(25_000);
    expect(toPaise(item.unitSupplierCost)).toBe(10_000);
    expect(toPaise(item.lineTotal)).toBe(50_000);
    expect(toPaise(item.lineSupplierCost)).toBe(20_000);
    expect((item.productSnapshot as { name: string }).name).toBe('Itest Checkout Product');
    expect(order!.events.some((e) => e.type === 'ORDER_PLACED')).toBe(true);
  }, 30_000);

  it('reserves LOCAL stock atomically at order time', async () => {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    expect(product!.stock).toBe(8); // 10 − 2 from the previous test
  });

  it('is idempotent: same key → same order, stock not double-decremented', async () => {
    const view = await addToCart({ userId, productId, quantity: 1 });
    const first = await createOrderFromCart({
      cartId: view.cartId,
      user: {
        id: userId,
        email: userEmail,
        name: 'Checkout Tester',
        role: 'CUSTOMER',
        status: 'ACTIVE',
      },
      address: TEST_ADDRESS,
      paymentMethod: 'PREPAID_GATEWAY',
      idempotencyKey: 'itest-key-idem-1',
    });
    const second = await createOrderFromCart({
      cartId: view.cartId,
      user: {
        id: userId,
        email: userEmail,
        name: 'Checkout Tester',
        role: 'CUSTOMER',
        status: 'ACTIVE',
      },
      address: TEST_ADDRESS,
      paymentMethod: 'PREPAID_GATEWAY',
      idempotencyKey: 'itest-key-idem-1',
    });
    expect(second.alreadyExisted).toBe(true);
    expect(second.orderId).toBe(first.orderId);
    expect(second.orderNumber).toBe(first.orderNumber);

    const product = await prisma.product.findUnique({ where: { id: productId } });
    expect(product!.stock).toBe(7); // decremented exactly once
  }, 30_000);

  it('a converted cart can never create a second order', async () => {
    const view = await addToCart({ userId, productId, quantity: 1 });
    const first = await createOrderFromCart({
      cartId: view.cartId,
      user: {
        id: userId,
        email: userEmail,
        name: 'Checkout Tester',
        role: 'CUSTOMER',
        status: 'ACTIVE',
      },
      address: TEST_ADDRESS,
      paymentMethod: 'PREPAID_GATEWAY',
    });
    const again = await createOrderFromCart({
      cartId: view.cartId,
      user: {
        id: userId,
        email: userEmail,
        name: 'Checkout Tester',
        role: 'CUSTOMER',
        status: 'ACTIVE',
      },
      address: TEST_ADDRESS,
      paymentMethod: 'PREPAID_GATEWAY',
    });
    expect(again.alreadyExisted).toBe(true);
    expect(again.orderId).toBe(first.orderId);
  }, 30_000);

  it('applies coupons server-side, caps usage and records redemptions', async () => {
    const coupon = await createTestCoupon({ type: 'FIXED', value: '50' });
    const view = await addToCart({ userId, productId, quantity: 1 }); // ₹250
    const result = await createOrderFromCart({
      cartId: view.cartId,
      user: {
        id: userId,
        email: userEmail,
        name: 'Checkout Tester',
        role: 'CUSTOMER',
        status: 'ACTIVE',
      },
      address: TEST_ADDRESS,
      paymentMethod: 'PREPAID_GATEWAY',
      couponCode: coupon.code.toLowerCase(), // case-insensitive input
    });

    const order = await prisma.order.findUnique({ where: { id: result.orderId } });
    expect(order!.couponCode).toBe(coupon.code);
    expect(toPaise(order!.discountTotal)).toBe(5_000);
    // 250 − 50 + 49 shipping
    expect(result.grandTotalPaise).toBe(24_900);

    const freshCoupon = await prisma.coupon.findUnique({ where: { code: coupon.code } });
    expect(freshCoupon!.usageCount).toBe(1);
    const redemption = await prisma.couponRedemption.findFirst({
      where: { couponCode: coupon.code },
    });
    expect(redemption).not.toBeNull();
    expect(toPaise(redemption!.amount)).toBe(5_000);
  }, 30_000);

  it('COD orders confirm immediately, carry the COD fee and settle on collection', async () => {
    const view = await addToCart({ userId, productId, quantity: 1 });
    const result = await createOrderFromCart({
      cartId: view.cartId,
      user: {
        id: userId,
        email: userEmail,
        name: 'Checkout Tester',
        role: 'CUSTOMER',
        status: 'ACTIVE',
      },
      address: TEST_ADDRESS,
      paymentMethod: 'COD',
    });
    // ₹250 + ₹49 shipping + ₹20 COD fee
    expect(result.grandTotalPaise).toBe(25_000 + 4_900 + 2_000);

    await confirmCodOrder(result.orderId);
    const confirmed = await prisma.order.findUniqueOrThrow({ where: { id: result.orderId } });
    expect(confirmed.paymentStatus).toBe('COD_PENDING');
    expect(confirmed.confirmedAt).not.toBeNull();
    expect(toPaise(confirmed.codFeeTotal)).toBe(2_000);
    // fulfilment may already be advancing via the job runner (async, demo supplier)
    expect(confirmed.status).not.toBe('PENDING_PAYMENT');

    // supplier order was created for the demo supplier leg
    const so = await prisma.supplierOrder.findFirst({ where: { orderId: result.orderId } });
    expect(so).not.toBeNull();
    expect(so!.supplierId).toBe(supplierId);
    expect(so!.idempotencyKey).toBeTruthy();

    await markCodCollected(result.orderId, userId);
    const collected = await prisma.order.findUniqueOrThrow({ where: { id: result.orderId } });
    expect(collected.paymentStatus).toBe('PAID');
    expect(collected.paidAt).not.toBeNull();
  }, 40_000);

  it('guest checkout stores guest identity without an account', async () => {
    const guestEmail = testEmail('guest');
    const view = await addToCart({ productId, quantity: 1 });
    const result = await createOrderFromCart({
      cartId: view.cartId,
      guest: { email: guestEmail, name: 'Guest Buyer', phone: '9876500000' },
      address: TEST_ADDRESS,
      paymentMethod: 'PREPAID_GATEWAY',
    });
    const order = await prisma.order.findUnique({ where: { id: result.orderId } });
    expect(order!.userId).toBeNull();
    expect(order!.guestEmail).toBe(guestEmail);
    expect(order!.guestName).toBe('Guest Buyer');
  }, 30_000);

  it('rejects empty carts', async () => {
    const view = await addToCart({ userId, productId, quantity: 1 });
    await prisma.cartItem.deleteMany({ where: { cartId: view.cartId } });
    await expect(
      createOrderFromCart({
        cartId: view.cartId,
        user: {
          id: userId,
          email: userEmail,
          name: 'Checkout Tester',
          role: 'CUSTOMER',
          status: 'ACTIVE',
        },
        address: TEST_ADDRESS,
        paymentMethod: 'PREPAID_GATEWAY',
      })
    ).rejects.toThrow(/empty/i);
  }, 30_000);
});
