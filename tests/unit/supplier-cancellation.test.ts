import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    $transaction: vi.fn(),
    supplierOrder: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    job: { findUnique: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  sanitizeForLog: (value: unknown) => value,
}));
vi.mock('@/lib/suppliers/registry', () => ({ getSupplierAdapter: vi.fn() }));
vi.mock('@/lib/jobs/queue', () => ({ enqueueJob: vi.fn(), kickJobRunner: vi.fn() }));
vi.mock('@/lib/orders/state', () => ({
  transitionOrder: vi.fn(),
  recordOrderEvent: vi.fn(),
  canTransition: vi.fn(),
}));
vi.mock('@/lib/orders/finance', () => ({ recalcOrderFinancials: vi.fn() }));
vi.mock('@/lib/notifications/notify', () => ({ queueNotification: vi.fn() }));
vi.mock('@/lib/notifications/order-vars', () => ({ renderOrderEmailVars: vi.fn() }));

import { prisma } from '@/lib/db';
import { getSupplierAdapter } from '@/lib/suppliers/registry';
import { PermanentJobError } from '@/lib/jobs/errors';
import { cancelSupplierOrder, recordManualSupplierCancellation } from '@/lib/orders/fulfilment';

describe('supplier cancellation handling (mocked Prisma; no database guarantee)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.supplierOrder.updateMany).mockResolvedValue({ count: 1 } as never);
  });

  it('records manual-action detail and fails the job when the supplier has no cancellation API', async () => {
    vi.mocked(prisma.supplierOrder.findUnique).mockResolvedValue({
      id: 'supplier-order-test',
      status: 'ACCEPTED',
      cancellationStatus: 'REQUESTED',
      supplier: { name: 'Manual Supplier' },
    } as never);
    vi.mocked(getSupplierAdapter).mockReturnValue({
      capabilities: { cancellation: false },
    } as never);

    await expect(
      cancelSupplierOrder('supplier-order-test', 'customer requested cancellation')
    ).rejects.toBeInstanceOf(PermanentJobError);
    expect(prisma.supplierOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'supplier-order-test', cancellationStatus: 'REQUESTED' },
      data: {
        cancellationStatus: 'MANUAL_ACTION_REQUIRED',
        cancellationMessage:
          'Manual action required: cancellation is not available via API (Manual Supplier). Confirm cancellation with the supplier, then record it in Admin → Supplier orders.',
        lastError:
          'Manual action required: cancellation is not available via API (Manual Supplier). Confirm cancellation with the supplier, then record it in Admin → Supplier orders.',
      },
    });
  });

  it('uses the stable supplier order id and records API success as submitted, not confirmed', async () => {
    vi.mocked(prisma.supplierOrder.findUnique).mockResolvedValue({
      id: 'supplier-order-test',
      supplierOrderId: 'external-order-42',
      status: 'ACCEPTED',
      cancellationStatus: 'REQUESTED',
      supplier: { name: 'REST Supplier' },
    } as never);
    const cancelOrder = vi.fn().mockResolvedValue({ success: true, message: 'Request accepted' });
    vi.mocked(getSupplierAdapter).mockReturnValue({
      capabilities: { cancellation: true },
      cancelOrder,
    } as never);

    await cancelSupplierOrder('supplier-order-test', 'reason');

    expect(cancelOrder).toHaveBeenCalledWith(
      'external-order-42',
      'reason',
      'cancel_supplier-order-test'
    );
    expect(prisma.supplierOrder.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'supplier-order-test', cancellationStatus: 'SUBMITTING' },
      data: {
        cancellationStatus: 'SUBMITTED',
        cancellationMessage: 'Request accepted',
        lastError: null,
      },
    });
  });

  it('allows only one concurrent cancellation submission to enter the provider call', async () => {
    vi.mocked(prisma.supplierOrder.findUnique).mockResolvedValue({
      id: 'supplier-order-test',
      status: 'ACCEPTED',
      cancellationStatus: 'REQUESTED',
      supplier: { name: 'REST Supplier' },
    } as never);
    vi.mocked(prisma.supplierOrder.updateMany).mockResolvedValue({ count: 0 } as never);
    const cancelOrder = vi.fn();
    vi.mocked(getSupplierAdapter).mockReturnValue({
      capabilities: { cancellation: true },
      cancelOrder,
    } as never);

    await cancelSupplierOrder('supplier-order-test', 'reason');

    expect(prisma.supplierOrder.updateMany).toHaveBeenCalledOnce();
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it('does not automatically retry an ambiguous API error', async () => {
    vi.mocked(prisma.supplierOrder.findUnique).mockResolvedValue({
      id: 'supplier-order-test',
      supplierOrderId: 'external-order-42',
      status: 'ACCEPTED',
      cancellationStatus: 'REQUESTED',
      supplier: { name: 'REST Supplier' },
    } as never);
    const cancelOrder = vi.fn().mockRejectedValue(new Error('network timeout'));
    vi.mocked(getSupplierAdapter).mockReturnValue({
      capabilities: { cancellation: true },
      cancelOrder,
    } as never);

    await expect(cancelSupplierOrder('supplier-order-test', 'reason')).rejects.toBeInstanceOf(
      PermanentJobError
    );

    expect(cancelOrder).toHaveBeenCalledOnce();
    expect(prisma.supplierOrder.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'supplier-order-test', cancellationStatus: 'SUBMITTING' },
        data: expect.objectContaining({ cancellationStatus: 'MANUAL_ACTION_REQUIRED' }),
      })
    );
  });

  it('does not resubmit after API submission while waiting for supplier confirmation', async () => {
    vi.mocked(prisma.supplierOrder.findUnique).mockResolvedValue({
      id: 'supplier-order-test',
      status: 'ACCEPTED',
      cancellationStatus: 'SUBMITTED',
      cancellationMessage: 'Waiting for supplier confirmation',
      supplier: { name: 'REST Supplier' },
    } as never);

    await cancelSupplierOrder('supplier-order-test', 'reason');

    expect(getSupplierAdapter).not.toHaveBeenCalled();
    expect(prisma.supplierOrder.update).not.toHaveBeenCalled();
  });

  it('lets admins attest to a legacy cancelled row without implying a migration backfill', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'supplier-order-legacy' }]),
      supplierOrder: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'supplier-order-legacy',
          status: 'CANCELLED',
          cancellationStatus: 'NONE',
          supplier: { name: 'Legacy Supplier' },
          order: { orderNumber: 'ZV-LEGACY-1' },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      job: { findUnique: vi.fn().mockResolvedValue(null), updateMany: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-legacy' }) },
    };
    vi.mocked(prisma.$transaction).mockImplementation(
      async (callback) =>
        (callback as unknown as (transaction: typeof tx) => Promise<unknown>)(tx) as never
    );

    await recordManualSupplierCancellation({
      supplierOrderId: 'supplier-order-legacy',
      actorId: 'admin-1',
      actorEmail: 'admin@example.test',
      note: 'Supplier confirmed by phone, reference LEGACY-9',
      req: new Request('https://store.test/manual-cancel'),
    });

    expect(tx.supplierOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'supplier-order-legacy',
          status: 'CANCELLED',
          cancellationStatus: 'NONE',
        },
        data: expect.objectContaining({
          cancellationStatus: 'CONFIRMED',
          cancellationMessage: expect.stringContaining('reference LEGACY-9'),
        }),
      })
    );
    const data = tx.supplierOrder.updateMany.mock.calls[0]?.[0]?.data;
    expect(data).not.toHaveProperty('status');
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });

  it('records manual confirmation, closes the job without marking it successful, and audits atomically', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'supplier-order-test' }]),
      supplierOrder: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'supplier-order-test',
          status: 'ACCEPTED',
          cancellationStatus: 'MANUAL_ACTION_REQUIRED',
          supplier: { name: 'Manual Supplier' },
          order: { orderNumber: 'ZV-TEST-1' },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      job: {
        findUnique: vi.fn().mockResolvedValue({ id: 'job-1', status: 'FAILED' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    vi.mocked(prisma.$transaction).mockImplementation(
      async (callback) =>
        (callback as unknown as (transaction: typeof tx) => Promise<unknown>)(tx) as never
    );
    const req = new Request('https://store.test/manual-cancel', {
      headers: { 'x-forwarded-for': '203.0.113.7', 'user-agent': 'unit-test' },
    });

    await recordManualSupplierCancellation({
      supplierOrderId: 'supplier-order-test',
      actorId: 'admin-1',
      actorEmail: 'admin@example.test',
      note: 'Supplier confirmed by phone, reference ABC-42',
      req,
    });

    expect(tx.supplierOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ cancellationStatus: 'MANUAL_ACTION_REQUIRED' }),
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancellationStatus: 'CONFIRMED',
          cancelledAt: expect.any(Date),
        }),
      })
    );
    expect(tx.job.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1', status: { not: 'RUNNING' } },
        data: expect.objectContaining({
          status: 'CANCELLED',
          claimToken: null,
          lastError: expect.stringContaining('Supplier confirmed by phone'),
        }),
      })
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'supplier_order.manual_cancellation_confirmed',
          entityType: 'SupplierOrder',
          entityId: 'supplier-order-test',
          actorId: 'admin-1',
        }),
      })
    );
  });
});
