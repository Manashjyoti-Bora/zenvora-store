import type { Prisma } from '@prisma/client';
import { prisma } from './db';

const MAX_ATTEMPTS = 4;

/** PostgreSQL serialization/deadlock failures are safe to retry only because
 * the entire database transaction rolls back before another attempt. */
export function isRetryableTransactionConflict(error: unknown): boolean {
  const candidate = error as { code?: unknown; meta?: { code?: unknown } } | null;
  const prismaCode = candidate?.code;
  const databaseCode = candidate?.meta?.code;
  return (
    prismaCode === 'P2034' ||
    databaseCode === '40001' ||
    databaseCode === '40P01' ||
    prismaCode === '40001' ||
    prismaCode === '40P01'
  );
}

/**
 * Run a Serializable PostgreSQL transaction with a small bounded retry budget.
 * Callers must keep provider/API calls outside the callback: retries repeat
 * database work only, never an external financial side effect.
 */
export async function withSerializableTransactionRetry<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { isolationLevel: 'Serializable' } = { isolationLevel: 'Serializable' }
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(operation, options);
    } catch (error) {
      if (!isRetryableTransactionConflict(error) || attempt >= MAX_ATTEMPTS) throw error;
      // Short jitter avoids immediately recreating the same lock schedule.
      const delayMs = Math.min(80, 5 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 5);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
