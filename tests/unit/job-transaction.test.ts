import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('next/server', () => ({ after: vi.fn() }));

import { enqueueJobInTransaction } from '@/lib/jobs/queue';

describe('enqueueJobInTransaction', () => {
  const create = vi.fn();
  const createMany = vi.fn();
  const findUnique = vi.fn();
  const updateMany = vi.fn();
  const tx = { job: { create, createMany, findUnique, updateMany } } as unknown as Parameters<
    typeof enqueueJobInTransaction
  >[0];

  beforeEach(() => {
    create.mockReset();
    createMany.mockReset();
    findUnique.mockReset();
    updateMany.mockReset();
    create.mockResolvedValue({ id: 'job-test' });
    createMany.mockResolvedValue({ count: 1 });
    updateMany.mockResolvedValue({ count: 1 });
  });

  it('uses conflict-safe insertion for deduplicated jobs in the caller transaction', async () => {
    await enqueueJobInTransaction(tx, {
      type: 'CANCEL_SUPPLIER_ORDER',
      payload: { supplierOrderId: 'supplier-order-test', reason: 'cancelled' },
      dedupeKey: 'cancel:supplier-order-test',
    });

    expect(createMany).toHaveBeenCalledOnce();
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          type: 'CANCEL_SUPPLIER_ORDER',
          payload: { supplierOrderId: 'supplier-order-test', reason: 'cancelled' },
          dedupeKey: 'cancel:supplier-order-test',
          maxAttempts: 6,
          nextRunAt: expect.any(Date),
        }),
      ],
      skipDuplicates: true,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('requeues a terminal deduplicated job using existing queue semantics', async () => {
    createMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue({ id: 'job-old', status: 'DONE' });
    const runAt = new Date('2026-11-07T00:00:00.000Z');
    const payload = { supplierOrderId: 'supplier-order-retry', reason: 'retry' };

    await enqueueJobInTransaction(tx, {
      type: 'CANCEL_SUPPLIER_ORDER',
      payload,
      dedupeKey: 'cancel:supplier-order-retry',
      runAt,
    });

    expect(findUnique).toHaveBeenCalledWith({
      where: { dedupeKey: 'cancel:supplier-order-retry' },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'job-old', status: { in: ['DONE', 'FAILED', 'CANCELLED'] } },
      data: {
        status: 'PENDING',
        payload,
        attempts: 0,
        lastError: null,
        nextRunAt: runAt,
        lockedAt: null,
        claimToken: null,
        completedAt: null,
      },
    });
  });

  it('does not reset a job that stopped being terminal before the conditional update', async () => {
    createMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue({ id: 'job-raced', status: 'DONE' });
    updateMany.mockResolvedValue({ count: 0 });

    await enqueueJobInTransaction(tx, {
      type: 'CANCEL_SUPPLIER_ORDER',
      payload: { supplierOrderId: 'supplier-order-raced', reason: 'retry' },
      dedupeKey: 'cancel:supplier-order-raced',
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-raced', status: { in: ['DONE', 'FAILED', 'CANCELLED'] } },
      })
    );
  });

  it('creates non-deduplicated work through the same transaction client', async () => {
    await enqueueJobInTransaction(tx, {
      type: 'SEND_NOTIFICATION',
      payload: { notificationId: 'notification-test' },
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'SEND_NOTIFICATION',
        payload: { notificationId: 'notification-test' },
        dedupeKey: null,
        maxAttempts: 6,
        nextRunAt: expect.any(Date),
      }),
    });
    expect(createMany).not.toHaveBeenCalled();
  });
});
