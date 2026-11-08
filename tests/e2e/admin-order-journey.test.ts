import './env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { toPaise } from '@/lib/money';
import { transitionOrder } from '@/lib/orders/state';
import { e2eAdmin } from './env';
import { HttpAgent, okData, waitForServer } from './http';
import { createFixtureUser, createSessionAgent } from './fixtures';

/**
 * Isolated admin/customer journey over real HTTP. The only direct service setup
 * is the supplier-accepted/processing precondition; ship, out-for-delivery,
 * delivery, COD collection, returns and refunds all use application endpoints.
 * Supplier rows are synthetic MANUAL records: no external supplier is called.
 */

const admin = new HttpAgent();
const anonymous = new HttpAgent();
let customer: HttpAgent;
let otherCustomer: HttpAgent;
let customerId = '';
let orderId = '';
let orderNumber = '';
let supplierOrderId = '';
let testOrderNumber = '';
let firstReturnId = '';
let approvedReturnId = '';
let refundId = '';
let refundRequestKey = '';

beforeAll(async () => {
  await waitForServer();
  if (!e2eAdmin.email || !e2eAdmin.password) {
    throw new Error('ADMIN_EMAIL/ADMIN_PASSWORD are required for the isolated admin journey');
  }

  await admin.get('/api/health');
  const adminLogin = await admin.post('/api/auth/login', {
    email: e2eAdmin.email,
    password: e2eAdmin.password,
  });
  expect(adminLogin.status, `admin login: ${adminLogin.body.slice(0, 200)}`).toBe(200);

  const owner = await createFixtureUser('e2e-admin-journey-owner');
  customerId = owner.id;
  customer = await createSessionAgent(owner);
  const other = await createFixtureUser('e2e-admin-journey-other');
  otherCustomer = await createSessionAgent(other);
  await anonymous.get('/api/health');

  const suffix =
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  orderNumber = `E2E-COD-${suffix}`;
  testOrderNumber = `E2E-TEST-${suffix}`;

  const order = await prisma.order.create({
    data: {
      orderNumber,
      userId: customerId,
      status: 'ORDER_CONFIRMED',
      paymentStatus: 'COD_PENDING',
      fulfilmentStatus: 'PENDING',
      paymentMethod: 'COD',
      subtotal: '250.00',
      grandTotal: '250.00',
      shippingAddress: {
        fullName: 'Isolated COD Customer',
        phone: '9876543210',
        line1: '1 Isolated Test Road',
        city: 'Guwahati',
        state: 'Assam',
        postalCode: '781001',
        country: 'IN',
      },
      placedAt: new Date(),
      confirmedAt: new Date(),
      items: {
        create: {
          productSnapshot: { name: 'Isolated COD journey item', synthetic: true },
          sku: `E2E-SKU-${suffix}`,
          quantity: 1,
          unitPrice: '250.00',
          unitSupplierCost: '100.00',
          lineTotal: '250.00',
        },
      },
    },
    include: { items: true },
  });
  orderId = order.id;

  const supplier = await prisma.supplier.upsert({
    where: { slug: 'e2e-isolated-manual-journey' },
    create: {
      name: 'Isolated E2E manual supplier (no API)',
      slug: 'e2e-isolated-manual-journey',
      type: 'MANUAL',
      isActive: true,
    },
    update: {},
  });
  const supplierOrder = await prisma.supplierOrder.create({
    data: {
      orderId,
      supplierId: supplier.id,
      idempotencyKey: `e2e-journey-${suffix}`,
      status: 'QUEUED',
      requestPayload: { synthetic: true, externalCall: false },
    },
  });
  supplierOrderId = supplierOrder.id;

  // Preconditions that have no standalone admin accept/process endpoint.
  for (const to of ['SENT_TO_SUPPLIER', 'SUPPLIER_ACCEPTED', 'PROCESSING'] as const) {
    await transitionOrder({
      orderId,
      to,
      actorType: 'SUPPLIER',
      set: { fulfilmentStatus: to },
      message: `Isolated journey precondition: ${to}`,
    });
  }

  await prisma.order.create({
    data: {
      orderNumber: testOrderNumber,
      userId: customerId,
      status: 'PAYMENT_VERIFIED',
      paymentStatus: 'PAID',
      paymentMethod: 'PREPAID_GATEWAY',
      subtotal: '100.00',
      grandTotal: '100.00',
      shippingAddress: { synthetic: true },
      paidAt: new Date(),
      payments: {
        create: {
          provider: 'TEST',
          providerOrderId: `e2e-provider-order-${suffix}`,
          providerPaymentId: `e2e-provider-payment-${suffix}`,
          amount: '100.00',
          status: 'PAID',
          feeIsEstimate: false,
          paidAt: new Date(),
        },
      },
    },
  });
}, 180_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('admin order list/detail and provider filtering', () => {
  it('renders the admin order detail and filters TEST by Payment.provider', async () => {
    const detail = await admin.get(`/admin/orders/${orderId}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toContain(orderNumber);

    const testOnly = await admin.get('/admin/orders?provider=TEST');
    expect(testOnly.status).toBe(200);
    expect(testOnly.body).toContain(testOrderNumber);
    expect(testOnly.body).not.toContain(orderNumber);

    const razorOnly = await admin.get('/admin/orders?provider=RAZORPAY');
    expect(razorOnly.status).toBe(200);
    expect(razorOnly.body).not.toContain(testOrderNumber);
    expect(razorOnly.body).not.toContain(orderNumber);
  });

  it('method=TEST is safely ignored rather than cast into the Prisma method enum', async () => {
    const response = await admin.get('/admin/orders?method=TEST');
    expect(response.status).toBe(200);
    expect(response.body).toContain(orderNumber);
    expect(response.body).toContain(testOrderNumber);

    const impossibleCombination = await admin.get('/admin/orders?method=COD&provider=TEST');
    expect(impossibleCombination.status).toBe(200);
    expect(impossibleCombination.body).not.toContain(orderNumber);
    expect(impossibleCombination.body).not.toContain(testOrderNumber);
  });
});

describe('authorization and customer isolation', () => {
  it('anonymous and non-admin users cannot collect COD or decide returns', async () => {
    const anon = await anonymous.post(`/api/admin/orders/${orderId}/cod-collected`, {});
    expect(anon.status).toBe(401);
    const customerAttempt = await customer.post(`/api/admin/orders/${orderId}/cod-collected`, {});
    expect(customerAttempt.status).toBe(403);
  });

  it('another customer cannot request a return on this order', async () => {
    const response = await otherCustomer.post(`/api/orders/${orderNumber}/return`, {
      reason: 'not my order',
    });
    expect(response.status).toBe(403);
    expect(await prisma.returnRequest.count({ where: { orderId } })).toBe(0);
  });
});

describe('shipment status transitions and collected COD', () => {
  it('admin ships, moves out for delivery, and marks delivery over HTTP', async () => {
    const shipped = await admin.post(`/api/admin/supplier-orders/${supplierOrderId}/ship`, {
      carrier: 'Isolated test carrier',
      trackingNumber: `E2E-TRACK-${Date.now()}`,
    });
    expect(shipped.status, shipped.body).toBe(200);

    for (const status of ['OUT_FOR_DELIVERY', 'DELIVERED'] as const) {
      const response = await admin.post('/api/admin/shipments', {
        orderId,
        supplierOrderId,
        carrier: 'Isolated test carrier',
        message: `Isolated journey ${status}`,
        status,
      });
      expect(response.status, response.body).toBe(200);
    }

    const delivered = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { shipments: true, events: true },
    });
    expect(delivered.status).toBe('DELIVERED');
    expect(delivered.fulfilmentStatus).toBe('DELIVERED');
    expect(delivered.deliveredAt).not.toBeNull();
    expect(
      delivered.shipments.some((shipment: { status: string }) => shipment.status === 'DELIVERED')
    ).toBe(true);
    expect(
      delivered.events.some(
        (event: { toStatus: string | null }) => event.toStatus === 'OUT_FOR_DELIVERY'
      )
    ).toBe(true);
  });

  it('admin records COD collection idempotently only after delivery', async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await admin.post(`/api/admin/orders/${orderId}/cod-collected`, {});
      expect(response.status, response.body).toBe(200);
    }
    const collected = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(collected.paymentStatus).toBe('PAID');
    expect(collected.paidAt).not.toBeNull();
    expect(await prisma.orderEvent.count({ where: { orderId, type: 'COD_COLLECTED' } })).toBe(1);

    const customerView = await customer.get(`/account/orders/${orderNumber}`);
    expect(customerView.status).toBe(200);
    expect(customerView.body).toContain('Cash collection recorded');
    expect(customerView.body).toContain('Payment method:');
    expect(customerView.body).toContain('Cash on Delivery');
  });
});

describe('customer return, admin decision/receipt, and manual partial refund', () => {
  it('customer requests a return and admin rejects it without creating a refund', async () => {
    const requested = await customer.post(`/api/orders/${orderNumber}/return`, {
      reason: 'First isolated return request',
      note: 'Synthetic database only',
    });
    expect(requested.status, requested.body).toBe(201);
    firstReturnId = okData<{ returnId: string }>(requested)!.returnId;

    const forbiddenDecision = await customer.post(`/api/admin/returns/${firstReturnId}/decide`, {
      decision: 'APPROVE',
    });
    expect(forbiddenDecision.status).toBe(403);

    const rejected = await admin.post(`/api/admin/returns/${firstReturnId}/decide`, {
      decision: 'REJECT',
      adminNote: 'Isolated rejection-path verification',
    });
    expect(rejected.status, rejected.body).toBe(200);
    const [returnRow, order] = await Promise.all([
      prisma.returnRequest.findUniqueOrThrow({ where: { id: firstReturnId } }),
      prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
    ]);
    expect(returnRow.status).toBe('REJECTED');
    expect(order.status).toBe('DELIVERED');
    expect(await prisma.refund.count({ where: { returnRequestId: firstReturnId } })).toBe(0);
  });

  it('a second request is approved without auto-refund, received, then manually refunded', async () => {
    const requested = await customer.post(`/api/orders/${orderNumber}/return`, {
      reason: 'Second isolated return request for approval and settlement',
    });
    expect(requested.status, requested.body).toBe(201);
    approvedReturnId = okData<{ returnId: string }>(requested)!.returnId;

    const approved = await admin.post(`/api/admin/returns/${approvedReturnId}/decide`, {
      decision: 'APPROVE',
      refundAmount: 0,
      adminNote: 'Approve receipt first; settle partial COD refund after receipt',
    });
    expect(approved.status, approved.body).toBe(200);
    expect(okData<{ status: string }>(approved)?.status).toBe('APPROVED');
    expect(await prisma.refund.count({ where: { returnRequestId: approvedReturnId } })).toBe(0);

    const received = await admin.post(`/api/admin/returns/${approvedReturnId}/decide`, {
      decision: 'MARK_RECEIVED',
      adminNote: 'Synthetic returned item received in isolated test',
    });
    expect(received.status, received.body).toBe(200);
    expect(okData<{ status: string }>(received)?.status).toBe('RECEIVED');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
      'RETURNED'
    );

    refundRequestKey = `e2e-cod-partial-${Date.now()}`;
    const created = await admin.post(
      '/api/admin/refunds',
      {
        orderId,
        amount: 50,
        reason: 'Isolated collected-COD partial manual refund',
        returnRequestId: approvedReturnId,
      },
      { headers: { 'Idempotency-Key': refundRequestKey } }
    );
    expect(created.status, created.body).toBe(201);
    const createdData = okData<{ refundId: string; status: string; duplicate: boolean }>(created)!;
    refundId = createdData.refundId;
    expect(createdData.status).toBe('REQUESTED');
    expect(createdData.duplicate).toBe(false);

    const refund = await prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
    expect(refund.provider).toBeNull();
    expect(refund.paymentId).toBeNull();
    expect(toPaise(refund.amount)).toBe(5_000);
  });

  it('replays the same refund request without duplication and settles it exactly once', async () => {
    const replay = await admin.post(
      '/api/admin/refunds',
      {
        orderId,
        amount: 50,
        reason: 'Isolated collected-COD partial manual refund',
        returnRequestId: approvedReturnId,
      },
      { headers: { 'Idempotency-Key': refundRequestKey } }
    );
    expect(replay.status, replay.body).toBe(200);
    expect(okData<{ refundId: string; duplicate: boolean }>(replay)).toMatchObject({
      refundId,
      duplicate: true,
    });
    expect(await prisma.refund.count({ where: { returnRequestId: approvedReturnId } })).toBe(1);

    const settled = await admin.post(`/api/admin/refunds/${refundId}/settle`, {
      status: 'COMPLETED',
      note: 'Synthetic manual settlement only; no real cash moved',
    });
    expect(settled.status, settled.body).toBe(200);
    expect(okData<{ settled: string; changed: boolean }>(settled)).toEqual({
      settled: 'COMPLETED',
      changed: true,
    });

    const settledAgain = await admin.post(`/api/admin/refunds/${refundId}/settle`, {
      status: 'COMPLETED',
    });
    expect(settledAgain.status).toBe(200);
    expect(okData<{ settled: string; changed: boolean }>(settledAgain)).toEqual({
      settled: 'COMPLETED',
      changed: false,
    });

    const [refund, order, returnRow, notifications] = await Promise.all([
      prisma.refund.findUniqueOrThrow({ where: { id: refundId } }),
      prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
      prisma.returnRequest.findUniqueOrThrow({ where: { id: approvedReturnId } }),
      prisma.notification.findMany({ where: { orderId, template: 'REFUND_COMPLETED' } }),
    ]);
    expect(refund.status).toBe('COMPLETED');
    expect(refund.processedAt).not.toBeNull();
    expect(order.paymentStatus).toBe('PARTIALLY_REFUNDED');
    expect(order.status).toBe('REFUND_PENDING'); // explicit review after partial settlement
    expect(toPaise(order.refundedTotal)).toBe(5_000);
    expect(returnRow.status).toBe('REFUNDED');
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.bodyHtml).toContain('No payment gateway was used');
    expect(notifications[0]!.bodyHtml).not.toContain('processed by the payment gateway');
  });
});
