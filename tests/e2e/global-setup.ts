/**
 * Runs ONCE before the whole e2e suite (vitest `globalSetup`).
 *
 * Rate-limit counters are shared through the database (see
 * src/lib/rate-limit.ts), so unlike the old in-memory limiter they survive a
 * dev-server restart. Clearing them here restores the "fresh server" budget
 * every spec file documents (register 5 / login 20 / checkout 10 per IP) so a
 * local re-run inside the 15-minute window is not throttled by the previous
 * run. Only the local `.env` database is ever touched.
 */
import path from 'node:path';
import dotenv from 'dotenv';

export default async function setup(): Promise<void> {
  dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), override: true });
  (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
  const { prisma } = await import('@/lib/db');
  try {
    await prisma.rateLimitBucket.deleteMany({});
  } finally {
    await prisma.$disconnect();
  }
}
