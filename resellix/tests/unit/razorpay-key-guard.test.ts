import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Safety gate: Razorpay key prefix must match the environment.
 *  - production + rzp_test_…  => refused (live store can never use sandbox)
 *  - non-production + rzp_live_… => refused (real money never moves in dev/test)
 * The env module reads process.env at import time, so each case resets the
 * module registry and re-imports with a controlled environment.
 */

const SAFE_KEYS = ['NODE_ENV', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'DATABASE_URL'];
const ORIGINAL: Record<string, string | undefined> = {};
for (const k of SAFE_KEYS) ORIGINAL[k] = process.env[k];

async function loadEnvModule(vars: Record<string, string | undefined>) {
  vi.resetModules();
  for (const k of SAFE_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v !== undefined) process.env[k] = v;
  }
  return import('@/lib/env');
}

afterEach(() => {
  vi.resetModules();
  for (const k of SAFE_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(ORIGINAL)) {
    if (v !== undefined) process.env[k] = v;
  }
});

const base = { DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:5432/unused' };

describe('razorpay key/environment guard', () => {
  it('refuses TEST keys in production', async () => {
    const mod = await loadEnvModule({
      ...base,
      NODE_ENV: 'production',
      RAZORPAY_KEY_ID: 'rzp_test_1234567890',
      RAZORPAY_KEY_SECRET: 'secret',
    });
    expect(mod.isRazorpayConfigured()).toBe(false);
    expect(mod.razorpayConfigIssue()).toMatch(/TEST key/);
  });

  it('accepts LIVE keys in production', async () => {
    const mod = await loadEnvModule({
      ...base,
      NODE_ENV: 'production',
      RAZORPAY_KEY_ID: 'rzp_live_1234567890',
      RAZORPAY_KEY_SECRET: 'secret',
    });
    expect(mod.isRazorpayConfigured()).toBe(true);
    expect(mod.razorpayConfigIssue()).toBeNull();
  });

  it('accepts TEST keys outside production', async () => {
    const mod = await loadEnvModule({
      ...base,
      NODE_ENV: 'development',
      RAZORPAY_KEY_ID: 'rzp_test_1234567890',
      RAZORPAY_KEY_SECRET: 'secret',
    });
    expect(mod.isRazorpayConfigured()).toBe(true);
  });

  it('refuses LIVE keys outside production', async () => {
    const mod = await loadEnvModule({
      ...base,
      NODE_ENV: 'development',
      RAZORPAY_KEY_ID: 'rzp_live_1234567890',
      RAZORPAY_KEY_SECRET: 'secret',
    });
    expect(mod.isRazorpayConfigured()).toBe(false);
    expect(mod.razorpayConfigIssue()).toMatch(/LIVE key/);
  });

  it('refuses incomplete credentials', async () => {
    const mod = await loadEnvModule({
      ...base,
      NODE_ENV: 'production',
      RAZORPAY_KEY_ID: 'rzp_live_1234567890',
    });
    expect(mod.isRazorpayConfigured()).toBe(false);
    expect(mod.razorpayConfigIssue()).toMatch(/not configured/);
  });
});
