import { afterAll, describe, expect, it } from 'vitest';
import { getSettings, updateSettings, invalidateSettingsCache } from '@/lib/settings';
import { cleanupTestData } from './fixtures';

describe('store settings (typed, persisted, cached)', () => {
  afterAll(async () => {
    // restore defaults touched by this suite
    await updateSettings({ payments: { feePercent: 2, feeFixedPaise: 0 } });
    await cleanupTestData();
  });

  it('returns complete, schema-valid settings', async () => {
    const s = await getSettings();
    expect(s.currency).toBe('INR');
    expect(s.payments).toBeDefined();
    expect(s.shipping).toBeDefined();
    expect(s.tax).toBeDefined();
    expect(s.policies).toBeDefined();
  });

  it('deep-merges partial patches without clobbering siblings', async () => {
    const before = await getSettings();
    const updated = await updateSettings({ payments: { feePercent: 3 } });
    expect(updated.payments.feePercent).toBe(3);
    // sibling keys survive
    expect(updated.payments.feeFixedPaise).toBe(before.payments.feeFixedPaise);
    expect(updated.shipping.flatRatePaise).toBe(before.shipping.flatRatePaise);
    expect(updated.tax.invoicePrefix).toBe(before.tax.invoicePrefix);
  });

  it('persists to the database (survives cache invalidation)', async () => {
    await updateSettings({ payments: { feePercent: 2.75 } });
    invalidateSettingsCache();
    const fresh = await getSettings();
    expect(fresh.payments.feePercent).toBe(2.75);
  });

  it('rejects invalid values loudly', async () => {
    await expect(updateSettings({ payments: { feePercent: 99 } })).rejects.toThrow();
    await expect(updateSettings({ currency: 'USD' })).rejects.toThrow();
  });
});
