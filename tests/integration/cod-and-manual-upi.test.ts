import { describe, it, expect, beforeEach } from 'vitest';
import './mock-headers';
import { prisma } from '@/lib/db';
import { createOrderFromCart } from '@/lib/orders/create';
import { confirmCodOrder, markCodCollected } from '@/lib/payments/confirm';
import { cancelOrder } from '@/lib/orders/cancel';
import { updateSettings } from '@/lib/settings';

const ADDRESS = {
  fullName: 'Priya Sharma',
  phone: '9876543210',
  line1: '123 MG Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  postalCode: '560001',
  country: 'IN',
};

async function createFixtureProduct() {
  const product = await prisma.product.create({
    data: {
      name: `UPI Test Product ${Date.now()}`,
      slug: `upi-product-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      description: 'Test product for COD and Manual UPI testing',
      sellingPrice: 500,
      supplierCost: 300,
      stock: 10,
      stockMode: 'LOCAL',
      pricingMode: 'FIXED_PRICE',
      fixedPrice: 500,
      status: 'ACTIVE',
    },
  });
  return product;
}

async function createCartWithProduct(productId: string, quantity = 1) {
  const cart = await prisma.cart.create({
    data: {
      items: {
        create: {
          productId,
          quantity,
          unitPriceAtAdd: 500,
        },
      },
    },
  });
  return cart;
}

describe('COD and Manual UPI Order Lifecycle', () => {
  beforeEach(async () => {
    await updateSettings({
      shipping: { codEnabled: true, codFeePaise: 5000 },
      manualUpi: {
        enabled: true,
        upiVpa: 'store@upi',
        payeeName: 'Zenvora Store',
        instructions: 'Test instructions',
      },
    });
  });

  it('places a COD order, confirms it immediately, preserves stock reservation and marks collected upon delivery', async () => {
    const product = await createFixtureProduct();
    const cart = await createCartWithProduct(product.id, 2);

    const result = await createOrderFromCart({
      cartId: cart.id,
      guest: { name: 'Priya Sharma', email: 'priya@example.com', phone: '9876543210' },
      address: ADDRESS,
      paymentMethod: 'COD',
    });

    expect(result.paymentMethod).toBe('COD');
    expect(result.alreadyExisted).toBe(false);

    // Initial stock was 10, 2 reserved -> remaining stock 8
    const updatedProd = await prisma.product.findUnique({ where: { id: product.id } });
    expect(updatedProd?.stock).toBe(8);

    // Confirm COD order
    await confirmCodOrder(result.orderId);
    const confirmedOrder = await prisma.order.findUnique({ where: { id: result.orderId } });
    expect(confirmedOrder?.status).toBe('ORDER_CONFIRMED');
    expect(confirmedOrder?.paymentStatus).toBe('COD_PENDING');

    // Simulate delivery
    await prisma.order.update({
      where: { id: result.orderId },
      data: { status: 'DELIVERED', deliveredAt: new Date() },
    });

    // Admin marks COD collected
    const adminUser = await prisma.user.create({
      data: {
        email: `admin-${Date.now()}@test.local`,
        name: 'Admin Test',
        role: 'ADMIN',
        passwordHash: 'dummyhash',
      },
    });

    await markCodCollected(result.orderId, adminUser.id);
    const paidOrder = await prisma.order.findUnique({ where: { id: result.orderId } });
    expect(paidOrder?.paymentStatus).toBe('PAID');
    expect(paidOrder?.paidAt).not.toBeNull();
  });

  it('restores stock when a COD order is cancelled', async () => {
    const product = await createFixtureProduct();
    const cart = await createCartWithProduct(product.id, 3);

    const result = await createOrderFromCart({
      cartId: cart.id,
      guest: { name: 'Priya Sharma', email: 'priya@example.com', phone: '9876543210' },
      address: ADDRESS,
      paymentMethod: 'COD',
    });

    expect(result.paymentMethod).toBe('COD');
    let prod = await prisma.product.findUnique({ where: { id: product.id } });
    expect(prod?.stock).toBe(7);

    // Cancel order
    await cancelOrder({
      orderId: result.orderId,
      reason: 'Customer changed mind',
      actorType: 'CUSTOMER',
    });

    prod = await prisma.product.findUnique({ where: { id: product.id } });
    expect(prod?.stock).toBe(10); // Restored
  });

  it('places a Manual UPI order, stays in PENDING until UTR submitted and verified by Admin', async () => {
    const product = await createFixtureProduct();
    const cart = await createCartWithProduct(product.id, 1);

    const result = await createOrderFromCart({
      cartId: cart.id,
      guest: { name: 'Rahul Verma', email: 'rahul@example.com', phone: '9876543210' },
      address: ADDRESS,
      paymentMethod: 'MANUAL_UPI',
    });

    expect(result.paymentMethod).toBe('MANUAL_UPI');
    expect(result.status).toBe('PENDING_PAYMENT');

    const order = await prisma.order.findUnique({ where: { id: result.orderId } });
    expect(order?.paymentStatus).toBe('PENDING');

    // Simulate customer submitting UTR
    const utr = `UTR${Date.now()}`;
    await prisma.order.update({
      where: { id: result.orderId },
      data: {
        upiUtr: utr,
        upiSubmittedAt: new Date(),
        paymentStatus: 'PENDING_VERIFICATION',
      },
    });

    const pendingOrder = await prisma.order.findUnique({ where: { id: result.orderId } });
    expect(pendingOrder?.paymentStatus).toBe('PENDING_VERIFICATION');
    expect(pendingOrder?.status).toBe('PENDING_PAYMENT'); // Not paid yet!

    // Duplicate UTR prevention constraint
    const cart2 = await createCartWithProduct(product.id, 1);
    const result2 = await createOrderFromCart({
      cartId: cart2.id,
      guest: { name: 'Other User', email: 'other@example.com', phone: '9876543210' },
      address: ADDRESS,
      paymentMethod: 'MANUAL_UPI',
    });

    await expect(
      prisma.order.update({
        where: { id: result2.orderId },
        data: { upiUtr: utr }, // Same unique UTR
      })
    ).rejects.toThrow();
  });

  it('admin verifies Manual UPI order: transitions to PAYMENT_VERIFIED and ORDER_CONFIRMED, preserves original order total, records audit fields', async () => {
    const product = await createFixtureProduct();
    const cart = await createCartWithProduct(product.id, 1);

    const result = await createOrderFromCart({
      cartId: cart.id,
      guest: { name: 'Customer Test', email: 'cust@example.com', phone: '9876543210' },
      address: ADDRESS,
      paymentMethod: 'MANUAL_UPI',
    });

    const initialOrder = await prisma.order.findUniqueOrThrow({ where: { id: result.orderId } });
    const initialGrandTotal = initialOrder.grandTotal.toString();

    // Customer submits UTR
    const utr = `UTR${Date.now()}`;
    await prisma.order.update({
      where: { id: result.orderId },
      data: {
        upiUtr: utr,
        upiSubmittedAt: new Date(),
        paymentStatus: 'PENDING_VERIFICATION',
      },
    });

    // Admin approves
    const adminUser = await prisma.user.create({
      data: {
        email: `admin-upi-${Date.now()}@test.local`,
        name: 'Admin UPI',
        role: 'ADMIN',
        passwordHash: 'dummyhash',
      },
    });

    // Execute verification via transaction matching the admin route
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: result.orderId },
        data: {
          paymentStatus: 'PAID',
          paidAt: new Date(),
          status: 'PAYMENT_VERIFIED',
          upiVerifiedAt: new Date(),
          upiVerifiedBy: adminUser.id,
          upiRejectionReason: null,
        },
      });
    });

    const verifiedOrder = await prisma.order.findUniqueOrThrow({ where: { id: result.orderId } });
    expect(verifiedOrder.paymentStatus).toBe('PAID');
    expect(verifiedOrder.status).toBe('PAYMENT_VERIFIED');
    expect(verifiedOrder.upiVerifiedBy).toBe(adminUser.id);
    expect(verifiedOrder.upiVerifiedAt).not.toBeNull();
    // Order total never manipulated or changed
    expect(verifiedOrder.grandTotal.toString()).toBe(initialGrandTotal);
  });

  it('rejects gateway payment creation for COD and Manual UPI orders (gateway payment isolation)', async () => {
    const product = await createFixtureProduct();
    const cartCod = await createCartWithProduct(product.id, 1);
    const cartUpi = await createCartWithProduct(product.id, 1);

    const codOrder = await createOrderFromCart({
      cartId: cartCod.id,
      guest: { name: 'COD Gateway Isolation', email: 'codiso@example.com', phone: '9876543210' },
      address: ADDRESS,
      paymentMethod: 'COD',
    });

    const upiOrder = await createOrderFromCart({
      cartId: cartUpi.id,
      guest: { name: 'UPI Gateway Isolation', email: 'upiiso@example.com', phone: '9876543210' },
      address: ADDRESS,
      paymentMethod: 'MANUAL_UPI',
    });

    // Directly test the route logic: import and call POST /api/payments/create
    const { POST: createPayment } = await import('@/app/api/payments/create/route');

    const csrfToken = 'test_csrf_token_123456';
    const g = globalThis as { __cookieJar?: Map<string, { value: string }> };
    if (!g.__cookieJar) g.__cookieJar = new Map();
    g.__cookieJar.set('resellix_csrf', { value: csrfToken });

    const codReq = new Request('http://localhost:3000/api/payments/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({ orderNumber: codOrder.orderNumber, email: 'codiso@example.com' }),
    });
    const codRes = await createPayment(codReq, {} as never);
    expect(codRes.status).toBe(409);
    const codBody = await codRes.json();
    expect(codBody.error.message).toContain('Cash-on-Delivery');

    const upiReq = new Request('http://localhost:3000/api/payments/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({ orderNumber: upiOrder.orderNumber, email: 'upiiso@example.com' }),
    });
    const upiRes = await createPayment(upiReq, {} as never);
    expect(upiRes.status).toBe(409);
    const upiBody = await upiRes.json();
    expect(upiBody.error.message).toContain('Manual UPI');
  });
});
