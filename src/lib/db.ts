import { PrismaClient } from '@prisma/client';
import { env, isDev } from './env';

/**
 * Prisma client singleton. In development, Next.js hot-reloading would
 * otherwise create a new client on every module re-evaluation and exhaust
 * the database connection pool.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isDev ? ['warn', 'error'] : ['error'],
    datasources: { db: { url: env.DATABASE_URL } },
  });

if (!isProductionEnv()) globalForPrisma.prisma = prisma;

function isProductionEnv(): boolean {
  return env.NODE_ENV === 'production';
}

export { Decimal } from '@prisma/client/runtime/library';
