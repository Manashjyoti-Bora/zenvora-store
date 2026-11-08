import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createRefund, settleRefund } from '@/lib/payments/refunds';
import { toPaise } from '@/lib/money';
import { cleanupTestData, createTestUser, testEmail, unique } from './fixtures';

/** TEST provider only: no Razorpay keys or real refund calls are used. */
describe('refund reservation concurrency and reconciliation', () => {
  let userId: string;

  beforeAll(async () => {
    await cleanupTestData();
    userId = (await createTestUser({ role: 'ADMIN' })).id;
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  async function makePaidOrder(amountPaise = 100_000) {
    const order = await prisma.order.create({
      data: {
        orderNumber: unique('ITEST-REFUND').toUpperCase(),
        userId,
        guestEmail: testEmail('refund-guest'),
        status: 'ORDER_CONFIRMED',
        paymentStatus: 'PAID',
        paymentMethod: 'PREPAID_GATEWAY',
        subtotal: (amountPaise / 100).toFixed(2),
        grandTotal: (amountPaise / 100).toFixed(2),
        shippingAddress: { synthetic: true },
        paidAt: new Date(),
      },
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'TEST',
        providerOrderId: unique('itest-refund-provider-order'),
        providerPaymentId: unique('itest-refund-provider-payment'),
        amount: (amountPaise / 100).toFixed(2),
        status: 'PAID',
        feeIsEstimate: false,
        paidAt: new Date(),
      },
    });
    return { order, payment };
  }

  function input(orderId: string, amountPaise: number, key?: string) {
    return {
      orderId,
      amountPaise,
      reason: 'Synthetic refund concurrency test',
      actor: 'ADMIN' as const,
      actorId: userId,
      idempotencyKey: key,
    };
  }

  it('allows only one of two simultaneous 60% reservations', async () => {
    const { order } = await makePaidOrder();
    const results = await Promise.allSettled([
      createRefund(input(order.id, 60_000, 'race-a')),
      createRefund(input(order.id, 60_000, 'race-b')),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const refunds = await prisma.refund.findMany({ where: { orderId: order.id } });
    expect(refunds).toHaveLength(1);
    expect(refunds.reduce((sum, refund) => sum + toPaise(refund.amount), 0)).toBe(60_000);
  });

  it('keeps payment and order ledgers correct for two valid concurrent partial refunds', async () => {
    const { order, payment } = await makePaidOrder();
    const results = await Promise.all([
      createRefund(input(order.id, 40_000, 'partial-a')),
      createRefund(input(order.id, 40_000, 'partial-b')),
    ]);
    expect(results.every((result) => !result.duplicate)).toBe(true);

    const refunds = await prisma.refund.findMany({ where: { orderId: order.id } });
    expect(refunds).toHaveLength(2);
    expect(refunds.reduce((sum, refund) => sum + toPaise(refund.amount), 0)).toBe(80_000);
    const refreshedPayment = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    expect(toPaise(refreshedPayment.refundedTotal)).toBe(80_000);
    const refreshed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(toPaise(refreshed.refundedTotal)).toBe(80_000);
    expect(refreshed.paymentStatus).toBe('PARTIALLY_REFUNDED');

    await expect(createRefund(input(order.id, 20_001, 'over-remaining'))).rejects.toThrow();
    expect(await prisma.refund.count({ where: { orderId: order.id } })).toBe(2);
  });

  it('deduplicates simultaneous requests with the same idempotency key', async () => {
    const { order } = await makePaidOrder();
    const results = await Promise.all([
      createRefund(input(order.id, 25_000, 'same-request')),
      createRefund(input(order.id, 25_000, 'same-request')),
    ]);

    expect(results[0].refundId).toBe(results[1].refundId);
    expect(results.filter((result) => result.duplicate)).toHaveLength(1);
    expect(await prisma.refund.count({ where: { orderId: order.id } })).toBe(1);
    await expect(createRefund(input(order.id, 26_000, 'same-request'))).rejects.toThrow();
    expect(await prisma.refund.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('deduplicates return-linked refunds even with different request keys', async () => {
    const { order } = await makePaidOrder();
    const returnRequest = await prisma.returnRequest.create({
      data: { orderId: order.id, reason: 'Synthetic duplicate return refund test' },
    });
    const results = await Promise.all([
      createRefund({
        ...input(order.id, 30_000, 'return-key-a'),
        returnRequestId: returnRequest.id,
      }),
      createRefund({
        ...input(order.id, 30_000, 'return-key-b'),
        returnRequestId: returnRequest.id,
      }),
    ]);

    expect(results[0].refundId).toBe(results[1].refundId);
    expect(results.filter((result) => result.duplicate)).toHaveLength(1);
    expect(await prisma.refund.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('reserves unresolved FAILED obligations and never downgrades a completed refund', async () => {
    const { order, payment } = await makePaidOrder();
    const failed = await prisma.refund.create({
      data: {
        orderId: order.id,
        paymentId: payment.id,
        amount: '600.00',
        status: 'FAILED',
        provider: 'TEST',
        reason: 'Synthetic unresolved refund obligation',
        failureReason: 'Synthetic unresolved provider outcome',
      },
    });

    await expect(createRefund(input(order.id, 40_001, 'failed-capacity'))).rejects.toThrow();
    await settleRefund({ refundId: failed.id, status: 'COMPLETED', actor: 'ADMIN' });
    const completed = await prisma.refund.findUniqueOrThrow({ where: { id: failed.id } });
    expect(completed.status).toBe('COMPLETED');
    expect(completed.processedAt).not.toBeNull();

    await settleRefund({ refundId: failed.id, status: 'FAILED', actor: 'PAYMENT_PROVIDER' });
    const afterLateFailure = await prisma.refund.findUniqueOrThrow({ where: { id: failed.id } });
    expect(afterLateFailure.status).toBe('COMPLETED');
    expect(afterLateFailure.processedAt).toEqual(completed.processedAt);
  });
});
