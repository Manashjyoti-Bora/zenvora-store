import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupplierAdapter, SupplierActionResult } from '@/lib/suppliers/types';
import { prisma } from '@/lib/db';
import { cancelSupplierOrder } from '@/lib/orders/fulfilment';
import { getSupplierAdapter } from '@/lib/suppliers/registry';
import { createTestSupplier, TEST_ADDRESS, unique } from './fixtures';

const { fakeCancelOrder } = vi.hoisted(() => ({
  fakeCancelOrder: vi.fn<(...args: unknown[]) => Promise<SupplierActionResult>>(),
}));

vi.mock('@/lib/suppliers/registry', () => ({
  getSupplierAdapter: vi.fn(),
}));

describe('supplier-cancellation state machine (PostgreSQL + controlled fake provider)', () => {
  const createdOrders: string[] = [];
  const createdSuppliers: string[] = [];

  beforeEach(() => {
    fakeCancelOrder.mockReset();
    vi.mocked(getSupplierAdapter).mockReturnValue({
      capabilities: { cancellation: true },
      cancelOrder: fakeCancelOrder,
    } as unknown as SupplierAdapter);
  });

  afterEach(async () => {
    await prisma.order.deleteMany({ where: { id: { in: createdOrders } } });
    await prisma.supplier.deleteMany({ where: { id: { in: createdSuppliers } } });
    createdOrders.length = 0;
    createdSuppliers.length = 0;
  });

  async function createRequestedSupplierOrder(
    cancellationStatus: 'REQUESTED' | 'SUBMITTING' = 'REQUESTED'
  ) {
    const supplier = await createTestSupplier();
    createdSuppliers.push(supplier.id);
    const order = await prisma.order.create({
      data: {
        orderNumber: unique('itest-supplier-cancel'),
        subtotal: '100.00',
        grandTotal: '100.00',
        shippingAddress: TEST_ADDRESS,
      },
    });
    createdOrders.push(order.id);
    const supplierOrder = await prisma.supplierOrder.create({
      data: {
        orderId: order.id,
        supplierId: supplier.id,
        idempotencyKey: unique('itest-supplier-cancel-so'),
        supplierOrderId: `fake-provider-${unique('order')}`,
        status: 'ACCEPTED',
        cancellationStatus,
      },
    });
    return supplierOrder;
  }

  it('records API acceptance as SUBMITTED, not CONFIRMED, and suppresses duplicate submission', async () => {
    fakeCancelOrder.mockResolvedValue({
      success: true,
      referenceId: 'fake-cancel-reference-1',
      message: 'Fake provider accepted request; supplier confirmation pending.',
    });
    const supplierOrder = await createRequestedSupplierOrder();

    await cancelSupplierOrder(supplierOrder.id, 'integration test');
    await cancelSupplierOrder(supplierOrder.id, 'integration retry must be suppressed');

    const persisted = await prisma.supplierOrder.findUniqueOrThrow({
      where: { id: supplierOrder.id },
    });
    expect(persisted.cancellationStatus).toBe('SUBMITTED');
    expect(persisted.status).toBe('ACCEPTED');
    expect(persisted.cancellationMessage).toContain('confirmation pending');
    expect(fakeCancelOrder).toHaveBeenCalledOnce();
    expect(fakeCancelOrder).toHaveBeenCalledWith(
      supplierOrder.supplierOrderId,
      'integration test',
      `cancel_${supplierOrder.id}`
    );
  }, 20_000);

  it('keeps an ambiguous provider result in manual review and prevents blind retry', async () => {
    fakeCancelOrder.mockRejectedValue(new Error('simulated provider timeout after request write'));
    const supplierOrder = await createRequestedSupplierOrder();

    await expect(
      cancelSupplierOrder(supplierOrder.id, 'ambiguous integration test')
    ).rejects.toThrow(/Manual action required/);
    await expect(cancelSupplierOrder(supplierOrder.id, 'must not resubmit')).rejects.toThrow(
      /Manual action required/
    );

    const persisted = await prisma.supplierOrder.findUniqueOrThrow({
      where: { id: supplierOrder.id },
    });
    expect(persisted.cancellationStatus).toBe('MANUAL_ACTION_REQUIRED');
    expect(persisted.status).toBe('ACCEPTED');
    expect(fakeCancelOrder).toHaveBeenCalledOnce();
  }, 20_000);

  it('recovers interrupted SUBMITTING work to manual review without calling the provider', async () => {
    const supplierOrder = await createRequestedSupplierOrder('SUBMITTING');

    await expect(
      cancelSupplierOrder(supplierOrder.id, 'worker interruption recovery')
    ).rejects.toThrow(/Manual action required/);

    const persisted = await prisma.supplierOrder.findUniqueOrThrow({
      where: { id: supplierOrder.id },
    });
    expect(persisted.cancellationStatus).toBe('MANUAL_ACTION_REQUIRED');
    expect(persisted.status).toBe('ACCEPTED');
    expect(fakeCancelOrder).not.toHaveBeenCalled();
  }, 20_000);
});
