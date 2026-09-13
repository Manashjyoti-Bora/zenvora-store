import { beforeEach, describe, expect, it } from 'vitest';
import { rateLimit, assertRateLimit, resetRateLimits } from '@/lib/rate-limit';
import { ApiError } from '@/lib/errors';

describe('rateLimit (brute-force / abuse protection)', () => {
  beforeEach(() => resetRateLimits());

  it('allows hits up to the limit inside the window', () => {
    const opts = { limit: 3, windowMs: 60_000 };
    expect(rateLimit('login:test', opts).success).toBe(true);
    expect(rateLimit('login:test', opts).success).toBe(true);
    const third = rateLimit('login:test', opts);
    expect(third.success).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it('blocks the hit after the limit and reports retryAfter', () => {
    const opts = { limit: 2, windowMs: 60_000 };
    rateLimit('k', opts);
    rateLimit('k', opts);
    const blocked = rateLimit('k', opts);
    expect(blocked.success).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('keeps separate buckets per key', () => {
    const opts = { limit: 1, windowMs: 60_000 };
    expect(rateLimit('a', opts).success).toBe(true);
    expect(rateLimit('a', opts).success).toBe(false);
    expect(rateLimit('b', opts).success).toBe(true);
  });

  it('resets when the window elapses', async () => {
    const opts = { limit: 1, windowMs: 60 };
    expect(rateLimit('w', opts).success).toBe(true);
    expect(rateLimit('w', opts).success).toBe(false);
    await new Promise((r) => setTimeout(r, 90));
    expect(rateLimit('w', opts).success).toBe(true);
  });

  it('assertRateLimit throws a 429 ApiError when exceeded', () => {
    const opts = { limit: 1, windowMs: 60_000 };
    expect(() => assertRateLimit('x', opts)).not.toThrow();
    try {
      assertRateLimit('x', opts);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).statusCode).toBe(429);
    }
  });
});
