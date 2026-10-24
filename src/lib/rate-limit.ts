import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { tooManyRequests } from './errors';
import { logger } from './logger';

/**
 * Fixed-window rate limiter with a SHARED store.
 *
 * Why shared: the application runs on serverless infrastructure (Vercel).
 * Every cold start / region / concurrent instance has its own process memory,
 * so a purely in-memory limiter only ever counts the hits that happen to land
 * on the same instance - an attacker spreading requests across instances is
 * never throttled. Counters therefore live in PostgreSQL (table
 * `rate_limit_buckets`), which every instance already talks to, and are
 * advanced with ONE atomic upsert per hit (no read-modify-write race).
 *
 * Properties
 *  - Atomic: a single `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` both
 *    rolls the window over and increments, so N concurrent hits with
 *    `limit = L` admit exactly L of them.
 *  - Privacy: keys embed client IPs / e-mail addresses; only a SHA-256 digest
 *    of the key is persisted.
 *  - Degrades, never breaks: if the database call fails (outage, migration not
 *    yet applied, …) the hit is counted in the local in-memory store instead,
 *    a warning is logged (throttled) and the request proceeds. The limiter is
 *    an abuse brake, not a correctness boundary - taking checkout down because
 *    the counter table is unreachable would be the wrong trade-off.
 *  - Bounded storage: expired rows are deleted by the cron housekeeping task
 *    (`purgeExpiredRateLimitBuckets`) and the key column is a fixed 64 chars.
 *
 * Tests: `RATE_LIMIT_STORE=memory` forces the in-memory store (used by the
 * e2e server so specs do not share counters with earlier runs).
 */

export interface RateLimitOptions {
  /** Maximum number of hits inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
  /** Which store answered - useful for diagnostics / tests. */
  store: 'database' | 'memory';
}

// ---------------------------------------------------------------------------
// In-memory store (single instance / fallback)
// ---------------------------------------------------------------------------

interface Bucket {
  count: number;
  resetAt: number;
}

const memoryBuckets = new Map<string, Bucket>();

// Periodic cleanup so the map cannot grow without bound.
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
function ensureCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of memoryBuckets) {
      if (bucket.resetAt <= now) memoryBuckets.delete(key);
    }
  }, 60_000);
  // Never keep the process alive just for cleanup.
  if (typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) cleanupTimer.unref();
}

/** Synchronous, process-local limiter. Exported for tests and as the fallback. */
export function memoryRateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  ensureCleanup();
  const now = Date.now();
  let bucket = memoryBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + opts.windowMs };
    memoryBuckets.set(key, bucket);
  }
  bucket.count += 1;
  return toResult(bucket.count, bucket.resetAt, now, opts, 'memory');
}

// ---------------------------------------------------------------------------
// Database store (shared across instances)
// ---------------------------------------------------------------------------

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

interface BucketRow {
  count: number;
  resetAt: Date;
}

async function databaseRateLimit(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
  const now = new Date();
  const nextReset = new Date(now.getTime() + opts.windowMs);
  const hashed = hashKey(key);
  // One statement, one round-trip. When the stored window has elapsed the row
  // is re-initialised (count = 1, new resetAt); otherwise it is incremented.
  // The CASE expressions evaluate against the row as locked by the UPDATE, so
  // concurrent hits serialise on the primary key and each sees the previous
  // count.
  const rows = await prisma.$queryRaw<BucketRow[]>(Prisma.sql`
    INSERT INTO "rate_limit_buckets" ("key", "count", "resetAt")
    VALUES (${hashed}, 1, ${nextReset})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "rate_limit_buckets"."resetAt" <= ${now} THEN 1
        ELSE "rate_limit_buckets"."count" + 1
      END,
      "resetAt" = CASE
        WHEN "rate_limit_buckets"."resetAt" <= ${now} THEN ${nextReset}
        ELSE "rate_limit_buckets"."resetAt"
      END
    RETURNING "count", "resetAt"
  `);
  const row = rows[0];
  if (!row) throw new Error('rate limit upsert returned no row');
  return toResult(Number(row.count), row.resetAt.getTime(), now.getTime(), opts, 'database');
}

function toResult(
  count: number,
  resetAt: number,
  now: number,
  opts: RateLimitOptions,
  store: RateLimitResult['store']
): RateLimitResult {
  return {
    success: count <= opts.limit,
    limit: opts.limit,
    remaining: Math.max(0, opts.limit - count),
    retryAfterSec: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    store,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

type StoreMode = 'database' | 'memory';

function configuredStore(): StoreMode {
  return process.env.RATE_LIMIT_STORE === 'memory' ? 'memory' : 'database';
}

// Log the fallback at most once a minute so an outage does not flood logs.
let lastFallbackLogAt = 0;
function noteFallback(err: unknown): void {
  const now = Date.now();
  if (now - lastFallbackLogAt < 60_000) return;
  lastFallbackLogAt = now;
  logger.warn('rate-limit: database store unavailable, using in-memory fallback', {
    error: err instanceof Error ? err.message : String(err),
  });
}

/**
 * Count one hit against `key` and report whether it is still inside the limit.
 * Never throws because of store problems (see module docs).
 */
export async function rateLimit(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
  if (configuredStore() === 'memory') return memoryRateLimit(key, opts);
  try {
    return await databaseRateLimit(key, opts);
  } catch (err) {
    noteFallback(err);
    return memoryRateLimit(key, opts);
  }
}

/** Throws a 429 ApiError when the limit is exceeded. */
export async function assertRateLimit(key: string, opts: RateLimitOptions): Promise<void> {
  const result = await rateLimit(key, opts);
  if (!result.success) {
    throw tooManyRequests(result.retryAfterSec);
  }
}

/**
 * Delete buckets whose window has elapsed. Called from the cron housekeeping
 * task; safe to run concurrently (plain DELETE, idempotent).
 */
export async function purgeExpiredRateLimitBuckets(now: Date = new Date()): Promise<number> {
  const res = await prisma.rateLimitBucket.deleteMany({ where: { resetAt: { lte: now } } });
  return res.count;
}

/** Reset the in-memory buckets (used by tests). */
export function resetRateLimits(): void {
  memoryBuckets.clear();
}
