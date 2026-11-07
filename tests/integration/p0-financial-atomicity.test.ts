import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { inspectFinancialReconciliation } from '@/lib/admin/financial-reconciliation';
import { cancelOrder } from '@/lib/orders/cancel';
import { createTestSupplier, TEST_ADDRESS, unique } from './fixtures';

describe('P0 order-cancellation transaction atomicity (PostgreSQL)', () => {
  it('reconciles persisted payment and completed-refund aggregates consistently', async () => {
    const order = await prisma.order.create({
      data: {
        orderNumber: unique('itest-reconciliation'),
        status: 'REFUND_PENDING',
        paymentStatus: 'PARTIALLY_REFUNDED',
        paymentMethod: 'PREPAID_GATEWAY',
        subtotal: '100.00',
        grandTotal: '100.00',
        refundedTotal: '25.00',
        shippingAddress: TEST_ADDRESS,
      },
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'TEST',
        amount: '100.00',
        refundedTotal: '25.00',
        status: 'PARTIALLY_REFUNDED',
      },
    });
    await prisma.refund.create({
      data: {
        orderId: order.id,
        paymentId: payment.id,
        provider: 'TEST',
        amount: '25.00',
        status: 'COMPLETED',
        reason: 'Reconciliation integration fixture',
        initiatedBy: 'ADMIN',
        processedAt: new Date(),
      },
    });

    try {
      const cleanFindings = await inspectFinancialReconciliation({ take: 1_000 });
      expect(cleanFindings.filter((finding) => finding.orderId === order.id)).toEqual([]);

      await prisma.order.update({ where: { id: order.id }, data: { refundedTotal: '0.00' } });
      const mismatchFindings = await inspectFinancialReconciliation({ take: 1_000 });
      expect(mismatchFindings).toContainEqual(
        expect.objectContaining({
          orderId: order.id,
          code: 'ORDER_REFUNDED_TOTAL_MISMATCH',
          expectedPaise: 2_500,
          actualPaise: 0,
        })
      );
    } finally {
      await prisma.order.deleteMany({ where: { id: order.id } });
    }
  }, 30_000);

  it('rejects cancellation of a terminal order without writing financial records', async () => {
    const order = await prisma.order.create({
      data: {
        orderNumber: unique('itest-terminal-cancel'),
        status: 'DELIVERED',
        paymentStatus: 'PAID',
        paymentMethod: 'PREPAID_GATEWAY',
        subtotal: '100.00',
        grandTotal: '100.00',
        shippingAddress: TEST_ADDRESS,
        deliveredAt: new Date(),
      },
    });

    try {
      await expect(
        cancelOrder({
          orderId: order.id,
          actorType: 'ADMIN',
          reason: 'must not cancel delivered order',
          force: true,
        })
      ).rejects.toThrow(/cannot be cancelled/i);
      const persisted = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(persisted.status).toBe('DELIVERED');
      expect(persisted.cancelledAt).toBeNull();
      expect(await prisma.refund.count({ where: { orderId: order.id } })).toBe(0);
    } finally {
      await prisma.order.deleteMany({ where: { id: order.id } });
    }
  }, 20_000);

  it('serializes duplicate concurrent cancellations into one refund reservation', async () => {
    const order = await prisma.order.create({
      data: {
        orderNumber: unique('itest-cancel-concurrent'),
        status: 'PAYMENT_VERIFIED',
        paymentStatus: 'PAID',
        paymentMethod: 'PREPAID_GATEWAY',
        subtotal: '100.00',
        grandTotal: '100.00',
        shippingAddress: TEST_ADDRESS,
        paidAt: new Date(),
      },
    });
    await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'TEST',
        amount: '100.00',
        status: 'PAID',
        providerPaymentId: null,
      },
    });

    try {
      const results = await Promise.allSettled([
        cancelOrder({ orderId: order.id, actorType: 'ADMIN', reason: 'first concurrent request' }),
        cancelOrder({
          orderId: order.id,
          actorType: 'ADMIN',
          reason: 'duplicate concurrent request',
        }),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const persistedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(persistedOrder.cancelledAt).not.toBeNull();
      expect(persistedOrder.status).toBe('REFUND_PENDING');
      const refunds = await prisma.refund.findMany({ where: { orderId: order.id } });
      expect(refunds).toHaveLength(1);
      expect(refunds[0]?.status).toBe('REQUESTED');
      expect(Number(refunds[0]?.amount)).toBe(100);
    } finally {
      await prisma.order.deleteMany({ where: { id: order.id } });
    }
  }, 30_000);

  it('rolls back order cancellation, refund reservation and supplier job together', async () => {
    const supplier = await createTestSupplier();
    const order = await prisma.order.create({
      data: {
        orderNumber: unique('itest-cancel-atomic'),
        status: 'PAYMENT_VERIFIED',
        paymentStatus: 'PAID',
        paymentMethod: 'PREPAID_GATEWAY',
        subtotal: '100.00',
        grandTotal: '100.00',
        shippingAddress: TEST_ADDRESS,
        paidAt: new Date(),
      },
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'TEST',
        amount: '100.00',
        status: 'PAID',
        providerPaymentId: null,
      },
    });
    const supplierOrder = await prisma.supplierOrder.create({
      data: {
        orderId: order.id,
        supplierId: supplier.id,
        idempotencyKey: unique('itest-cancel-atomic-so'),
        status: 'ACCEPTED',
      },
    });
    const dedupeKey = `cancel_${supplierOrder.id}`;
    const suffix = unique('cancel_insert_failure').replace(/[^a-zA-Z0-9_]/g, '_');
    const functionName = `ci_${suffix}_fn`;
    const triggerName = `ci_${suffix}_trigger`;

    try {
      // Fail only this cancellation job insert. This exercises the actual
      // PostgreSQL transaction boundary without affecting parallel CI tests.
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
        BEGIN
          IF NEW."dedupeKey" = '${dedupeKey}' THEN
            RAISE EXCEPTION 'forced cancellation job insert failure';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "jobs"
        FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
      `);

      await expect(
        cancelOrder({
          orderId: order.id,
          actorType: 'ADMIN',
          reason: 'Atomicity integration test',
        })
      ).rejects.toThrow(/forced cancellation job insert failure/);

      const [persistedOrder, persistedSupplierOrder] = await Promise.all([
        prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
        prisma.supplierOrder.findUniqueOrThrow({ where: { id: supplierOrder.id } }),
      ]);
      expect(persistedOrder.status).toBe('PAYMENT_VERIFIED');
      expect(persistedOrder.cancelledAt).toBeNull();
      expect(persistedSupplierOrder.cancellationStatus).toBe('NONE');
      expect(await prisma.refund.count({ where: { orderId: order.id } })).toBe(0);
      expect(await prisma.job.count({ where: { dedupeKey } })).toBe(0);
      const persistedPayment = await prisma.payment.findUniqueOrThrow({
        where: { id: payment.id },
      });
      expect(persistedPayment.status).toBe('PAID');
      expect(Number(persistedPayment.refundedTotal)).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "jobs"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
      await prisma.order.deleteMany({ where: { id: order.id } });
      await prisma.supplier.deleteMany({ where: { id: supplier.id } });
    }
  }, 30_000);
});
