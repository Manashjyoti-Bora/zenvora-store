import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryRateLimit, rateLimit, assertRateLimit, resetRateLimits } from '@/lib/rate-limit';
import { ApiError } from '@/lib/errors';

/**
 * Unit coverage for the in-memory store (used stand-alone when
 * RATE_LIMIT_STORE=memory and as the fallback when the database is
 * unreachable). The shared PostgreSQL store is covered by
 * tests/integration/rate-limit-shared.test.ts.
 */
describe('memoryRateLimit (process-local fixed window)', () => {
  beforeEach(() => resetRateLimits());

  it('allows hits up to the limit inside the window', () => {
    const opts = { limit: 3, windowMs: 60_000 };
    expect(memoryRateLimit('login:test', opts).success).toBe(true);
    expect(memoryRateLimit('login:test', opts).success).toBe(true);
    const third = memoryRateLimit('login:test', opts);
    expect(third.success).toBe(true);
    expect(third.remaining).toBe(0);
    expect(third.store).toBe('memory');
  });

  it('blocks the hit after the limit and reports retryAfter', () => {
    const opts = { limit: 2, windowMs: 60_000 };
    memoryRateLimit('k', opts);
    memoryRateLimit('k', opts);
    const blocked = memoryRateLimit('k', opts);
    expect(blocked.success).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('keeps separate buckets per key', () => {
    const opts = { limit: 1, windowMs: 60_000 };
    expect(memoryRateLimit('a', opts).success).toBe(true);
    expect(memoryRateLimit('a', opts).success).toBe(false);
    expect(memoryRateLimit('b', opts).success).toBe(true);
  });

  it('resets when the window elapses', async () => {
    const opts = { limit: 1, windowMs: 60 };
    expect(memoryRateLimit('w', opts).success).toBe(true);
    expect(memoryRateLimit('w', opts).success).toBe(false);
    await new Promise((r) => setTimeout(r, 90));
    expect(memoryRateLimit('w', opts).success).toBe(true);
  });
});

describe('rateLimit / assertRateLimit with RATE_LIMIT_STORE=memory', () => {
  beforeEach(() => {
    resetRateLimits();
    vi.stubEnv('RATE_LIMIT_STORE', 'memory');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('uses the memory store without touching the database', async () => {
    const res = await rateLimit('m', { limit: 1, windowMs: 60_000 });
    expect(res.store).toBe('memory');
    expect(res.success).toBe(true);
  });

  it('assertRateLimit throws a 429 ApiError when exceeded', async () => {
    const opts = { limit: 1, windowMs: 60_000 };
    await expect(assertRateLimit('x', opts)).resolves.toBeUndefined();
    try {
      await assertRateLimit('x', opts);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).statusCode).toBe(429);
    }
  });
});
