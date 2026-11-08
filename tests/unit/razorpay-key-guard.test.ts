import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Razorpay availability requires a complete integration, not merely two
 * server-side strings. Each case re-imports env with an isolated process.env.
 */
const SAFE_KEYS = [
  'NODE_ENV',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'NEXT_PUBLIC_RAZORPAY_KEY_ID',
  'RAZORPAY_WEBHOOK_SECRET',
  'PAYMENTS_TEST_MODE',
  'DATABASE_URL',
];
const ORIGINAL: Record<string, string | undefined> = {};
for (const key of SAFE_KEYS) ORIGINAL[key] = process.env[key];

async function loadEnvModule(vars: Record<string, string | undefined>) {
  vi.resetModules();
  for (const key of SAFE_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined) process.env[key] = value;
  }
  return import('@/lib/env');
}

afterEach(() => {
  vi.resetModules();
  for (const key of SAFE_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value !== undefined) process.env[key] = value;
  }
});

const base = { DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:5432/unused' };
const live = {
  RAZORPAY_KEY_ID: 'rzp_live_1234567890',
  RAZORPAY_KEY_SECRET: 'server-secret',
  NEXT_PUBLIC_RAZORPAY_KEY_ID: 'rzp_live_1234567890',
  RAZORPAY_WEBHOOK_SECRET: 'webhook-secret',
};
const testKeys = {
  ...live,
  RAZORPAY_KEY_ID: 'rzp_test_1234567890',
  NEXT_PUBLIC_RAZORPAY_KEY_ID: 'rzp_test_1234567890',
};

describe('complete Razorpay integration guard', () => {
  it('accepts a complete LIVE integration in production', async () => {
    const mod = await loadEnvModule({ ...base, ...live, NODE_ENV: 'production' });
    expect(mod.razorpayConfigIssue()).toBeNull();
    expect(mod.isRazorpayConfigured()).toBe(true);
  });

  it('accepts a complete TEST integration outside production', async () => {
    const mod = await loadEnvModule({ ...base, ...testKeys, NODE_ENV: 'development' });
    expect(mod.razorpayConfigIssue()).toBeNull();
    expect(mod.isRazorpayConfigured()).toBe(true);
  });

  it.each([
    ['server secret', { RAZORPAY_KEY_SECRET: undefined }, /server keys are not configured/i],
    ['browser key', { NEXT_PUBLIC_RAZORPAY_KEY_ID: undefined }, /browser key is not configured/i],
    ['webhook secret', { RAZORPAY_WEBHOOK_SECRET: undefined }, /webhook confirmation/i],
    [
      'matching browser key',
      { NEXT_PUBLIC_RAZORPAY_KEY_ID: 'rzp_live_different_key' },
      /must exactly match/i,
    ],
  ])('refuses a missing or mismatched %s', async (_label, override, reason) => {
    const mod = await loadEnvModule({
      ...base,
      ...live,
      ...override,
      NODE_ENV: 'production',
    });
    expect(mod.isRazorpayConfigured()).toBe(false);
    expect(mod.razorpayConfigIssue()).toMatch(reason);
  });

  it('refuses TEST keys in production even when every variable is present', async () => {
    const mod = await loadEnvModule({ ...base, ...testKeys, NODE_ENV: 'production' });
    expect(mod.isRazorpayConfigured()).toBe(false);
    expect(mod.razorpayConfigIssue()).toMatch(/must be a LIVE key/i);
  });

  it('refuses LIVE keys outside production even when every variable is present', async () => {
    const mod = await loadEnvModule({ ...base, ...live, NODE_ENV: 'development' });
    expect(mod.isRazorpayConfigured()).toBe(false);
    expect(mod.razorpayConfigIssue()).toMatch(/must be a TEST key/i);
  });

  it.each(['development', 'production'] as const)(
    'refuses an unrecognised key prefix in %s',
    async (NODE_ENV) => {
      const mod = await loadEnvModule({
        ...base,
        ...live,
        RAZORPAY_KEY_ID: 'not-a-razorpay-key',
        NEXT_PUBLIC_RAZORPAY_KEY_ID: 'not-a-razorpay-key',
        NODE_ENV,
      });
      expect(mod.isRazorpayConfigured()).toBe(false);
      expect(mod.razorpayConfigIssue()).toMatch(/unrecognised keys are refused/i);
    }
  );
});

describe('provider availability follows the complete guard', () => {
  it('describes RAZORPAY only for a complete integration', async () => {
    await loadEnvModule({
      ...base,
      ...testKeys,
      NODE_ENV: 'development',
      PAYMENTS_TEST_MODE: 'true',
    });
    const { describePaymentProvider } = await import('@/lib/payments');
    expect(describePaymentProvider().kind).toBe('RAZORPAY');
  });

  it('falls back to TEST only outside production when Razorpay is incomplete', async () => {
    await loadEnvModule({
      ...base,
      ...testKeys,
      NEXT_PUBLIC_RAZORPAY_KEY_ID: undefined,
      NODE_ENV: 'development',
      PAYMENTS_TEST_MODE: 'true',
    });
    const { describePaymentProvider } = await import('@/lib/payments');
    expect(describePaymentProvider()).toMatchObject({ kind: 'TEST', isTest: true });
  });

  it('is NONE for incomplete Razorpay when no TEST provider is allowed', async () => {
    await loadEnvModule({
      ...base,
      ...live,
      NEXT_PUBLIC_RAZORPAY_KEY_ID: 'rzp_live_mismatch',
      NODE_ENV: 'production',
      PAYMENTS_TEST_MODE: 'true',
    });
    const { describePaymentProvider } = await import('@/lib/payments');
    expect(describePaymentProvider()).toMatchObject({ kind: 'NONE', isTest: false });
  });
});
