import { tooManyRequests } from './errors';

/**
 * In-memory fixed-window rate limiter.
 *
 * Suitable for a single-instance deployment (the default for this project's
 * low-cost architecture). For horizontal scaling, swap the storage with Redis
 * (e.g. Upstash) - the interface stays identical.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Periodic cleanup so the map cannot grow without bound.
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
function ensureCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, 60_000);
  // Never keep the process alive just for cleanup.
  if (typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) cleanupTimer.unref();
}

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
}

export function rateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  ensureCleanup();
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + opts.windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  const success = bucket.count <= opts.limit;
  return {
    success,
    limit: opts.limit,
    remaining: Math.max(0, opts.limit - bucket.count),
    retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

/** Throws a 429 ApiError when the limit is exceeded. */
export function assertRateLimit(key: string, opts: RateLimitOptions): void {
  const result = rateLimit(key, opts);
  if (!result.success) {
    throw tooManyRequests(result.retryAfterSec);
  }
}

/** Reset all buckets (used by tests). */
export function resetRateLimits(): void {
  buckets.clear();
}
