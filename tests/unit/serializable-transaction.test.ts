import { beforeEach, describe, expect, it, vi } from 'vitest';

const { transaction } = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { $transaction: transaction } }));

import {
  isRetryableTransactionConflict,
  withSerializableTransactionRetry,
} from '@/lib/db-transaction';

describe('Serializable transaction conflict retry', () => {
  beforeEach(() => {
    transaction.mockReset();
  });

  it('retries a rolled-back PostgreSQL serialization conflict', async () => {
    transaction
      .mockImplementationOnce(async (callback) => {
        await callback({});
        throw { code: 'P2010', meta: { code: '40001' } };
      })
      .mockImplementationOnce(async (callback) => callback({}));
    const operation = vi.fn(async () => 'operation result');

    await expect(withSerializableTransactionRetry(operation)).resolves.toBe('operation result');
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(transaction).toHaveBeenCalledWith(operation, { isolationLevel: 'Serializable' });
  });

  it('recognizes Prisma transaction conflicts and PostgreSQL deadlocks', () => {
    expect(isRetryableTransactionConflict({ code: 'P2034' })).toBe(true);
    expect(isRetryableTransactionConflict({ code: 'P2010', meta: { code: '40P01' } })).toBe(true);
    expect(isRetryableTransactionConflict({ code: 'P2002' })).toBe(false);
    expect(isRetryableTransactionConflict(new Error('validation'))).toBe(false);
  });

  it('does not retry a non-conflict database error', async () => {
    transaction.mockImplementation(async (callback) => {
      await callback({});
      throw { code: 'P2002' };
    });
    const operation = vi.fn();

    await expect(withSerializableTransactionRetry(operation)).rejects.toEqual({ code: 'P2002' });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('stops after four rolled-back conflict attempts', async () => {
    transaction.mockImplementation(async (callback) => {
      await callback({});
      throw { code: 'P2010', meta: { code: '40001' } };
    });
    const operation = vi.fn();

    await expect(withSerializableTransactionRetry(operation)).rejects.toEqual({
      code: 'P2010',
      meta: { code: '40001' },
    });
    expect(transaction).toHaveBeenCalledTimes(4);
    expect(operation).toHaveBeenCalledTimes(4);
  });
});
