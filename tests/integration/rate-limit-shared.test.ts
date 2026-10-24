import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import {
  assertRateLimit,
  purgeExpiredRateLimitBuckets,
  rateLimit,
  resetRateLimits,
} from '@/lib/rate-limit';
import { ApiError } from '@/lib/errors';
import { unique } from './fixtures';

/**
 * The shared (PostgreSQL-backed) rate limiter. These tests prove the
 * properties the serverless deployment relies on:
 *  - counters live in the database, not in process memory;
 *  - a burst of concurrent hits is counted atomically (exactly `limit` admitted);
 *  - windows roll over; expired rows are purged;
 *  - keys are stored hashed (no raw IPs / e-mails at rest);
 *  - a store failure degrades to the in-memory limiter instead of failing requests.
 */
describe('rateLimit (shared PostgreSQL store)', () => {
  const keys: string[] = [];
  const key = (prefix: string) => {
    const k = unique(`itest:${prefix}`);
    keys.push(k);
    return k;
  };
  const hashed = (k: string) => createHash('sha256').update(k).digest('hex');

  beforeEach(() => {
    resetRateLimits();
    vi.unstubAllEnvs();
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.rateLimitBucket.deleteMany({ where: { key: { in: keys.map(hashed) } } });
  });

  it('counts hits in the database and ignores process memory', async () => {
    const k = key('db');
    const opts = { limit: 2, windowMs: 60_000 };
    const first = await rateLimit(k, opts);
    expect(first.store).toBe('database');
    expect(first.success).toBe(true);
    expect(first.remaining).toBe(1);

    // Simulate a different serverless instance: fresh process memory.
    resetRateLimits();
    const second = await rateLimit(k, opts);
    expect(second.success).toBe(true);
    expect(second.remaining).toBe(0);

    resetRateLimits();
    const third = await rateLimit(k, opts);
    expect(third.success).toBe(false);
    expect(third.retryAfterSec).toBeGreaterThan(0);
    expect(third.retryAfterSec).toBeLessThanOrEqual(60);

    const row = await prisma.rateLimitBucket.findUnique({ where: { key: hashed(k) } });
    expect(row?.count).toBe(3);
  });

  it('stores only a hash of the key (no raw IP / e-mail at rest)', async () => {
    const k = key('privacy:203.0.113.7:someone@example.com');
    await rateLimit(k, { limit: 5, windowMs: 60_000 });
    const rows = await prisma.$queryRaw<{ key: string }[]>`
      SELECT "key" FROM "rate_limit_buckets" WHERE "key" LIKE '%example.com%' OR "key" LIKE '%203.0.113.7%'
    `;
    expect(rows).toHaveLength(0);
    expect(await prisma.rateLimitBucket.findUnique({ where: { key: hashed(k) } })).not.toBeNull();
  });

  it('admits exactly `limit` hits out of a concurrent burst (atomic upsert)', async () => {
    const k = key('burst');
    const opts = { limit: 10, windowMs: 60_000 };
    const results = await Promise.all(Array.from({ length: 25 }, () => rateLimit(k, opts)));
    const admitted = results.filter((r) => r.success).length;
    expect(admitted).toBe(10);
    expect(results.every((r) => r.store === 'database')).toBe(true);
  });

  it('rolls the window over once resetAt has passed', async () => {
    const k = key('window');
    const opts = { limit: 1, windowMs: 60_000 };
    expect((await rateLimit(k, opts)).success).toBe(true);
    expect((await rateLimit(k, opts)).success).toBe(false);

    // Age the stored window instead of sleeping.
    await prisma.rateLimitBucket.update({
      where: { key: hashed(k) },
      data: { resetAt: new Date(Date.now() - 1_000) },
    });
    const fresh = await rateLimit(k, opts);
    expect(fresh.success).toBe(true);
    expect(fresh.remaining).toBe(0);
    const row = await prisma.rateLimitBucket.findUnique({ where: { key: hashed(k) } });
    expect(row?.count).toBe(1);
    expect(row!.resetAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('purges expired buckets and keeps live ones', async () => {
    const live = key('purge-live');
    const dead = key('purge-dead');
    await rateLimit(live, { limit: 5, windowMs: 60_000 });
    await rateLimit(dead, { limit: 5, windowMs: 60_000 });
    await prisma.rateLimitBucket.update({
      where: { key: hashed(dead) },
      data: { resetAt: new Date(Date.now() - 5_000) },
    });
    const purged = await purgeExpiredRateLimitBuckets();
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(await prisma.rateLimitBucket.findUnique({ where: { key: hashed(dead) } })).toBeNull();
    expect(await prisma.rateLimitBucket.findUnique({ where: { key: hashed(live) } })).not.toBeNull();
  });

  it('assertRateLimit surfaces a 429 ApiError with Retry-After seconds', async () => {
    const k = key('assert');
    const opts = { limit: 1, windowMs: 60_000 };
    await expect(assertRateLimit(k, opts)).resolves.toBeUndefined();
    await expect(assertRateLimit(k, opts)).rejects.toSatisfy(
      (err: unknown) => err instanceof ApiError && err.statusCode === 429
    );
  });

  it('falls back to the in-memory store when the database call fails', async () => {
    const k = key('fallback');
    const spy = vi.spyOn(prisma, '$queryRaw').mockRejectedValue(new Error('connection refused'));
    try {
      const opts = { limit: 1, windowMs: 60_000 };
      const first = await rateLimit(k, opts);
      expect(first.store).toBe('memory');
      expect(first.success).toBe(true);
      const second = await rateLimit(k, opts);
      expect(second.store).toBe('memory');
      expect(second.success).toBe(false);
    } finally {
      spy.mockRestore();
    }
    // Store healthy again → back on the database path.
    expect((await rateLimit(k, { limit: 5, windowMs: 60_000 })).store).toBe('database');
  });
});
