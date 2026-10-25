import { describe, expect, it } from 'vitest';
import { ACTION_MIN_LEVEL, AUTOMATION_MAX_LEVEL, canPerform, permissionLevelOf } from '@/lib/auth/permissions';
import { deterministicTitleCleanup, getAiStatus } from '@/lib/ai/provider';

const u = (role: 'CUSTOMER' | 'STAFF' | 'ADMIN', status: 'ACTIVE' | 'DISABLED' = 'ACTIVE') =>
  ({ role, status }) as const;

describe('permission levels', () => {
  it('maps roles to levels and treats non-active users as anonymous', () => {
    expect(permissionLevelOf(null)).toBe(0);
    expect(permissionLevelOf(u('CUSTOMER'))).toBe(1);
    expect(permissionLevelOf(u('STAFF'))).toBe(3);
    expect(permissionLevelOf(u('ADMIN'))).toBe(4);
    expect(permissionLevelOf(u('ADMIN', 'DISABLED'))).toBe(0);
  });
  it('publishing, settings, payments and users are owner-only (level 4)', () => {
    for (const a of ['catalog.publish', 'settings.write', 'payments.manage', 'users.manage', 'ai.configure'] as const) {
      expect(ACTION_MIN_LEVEL[a]).toBe(4);
      expect(canPerform(u('STAFF'), a)).toBe(false);
      expect(canPerform(u('ADMIN'), a)).toBe(true);
    }
  });
  it('staff can run syncs / dry runs / draft imports but customers cannot', () => {
    expect(canPerform(u('STAFF'), 'supplier.dryrun.run')).toBe(true);
    expect(canPerform(u('CUSTOMER'), 'supplier.dryrun.run')).toBe(false);
    expect(canPerform(null, 'ops.dashboard.read')).toBe(false);
  });
  it('automation can never reach the owner level', () => {
    expect(AUTOMATION_MAX_LEVEL).toBeLessThan(4);
    expect(AUTOMATION_MAX_LEVEL < ACTION_MIN_LEVEL['catalog.publish']).toBe(true);
  });
});

describe('AI status', () => {
  it('is disabled with an honest reason and a deterministic fallback', () => {
    const s = getAiStatus();
    expect(s.enabled).toBe(false);
    expect(s.provider).toBeNull();
    expect(s.fallback).toBe('DETERMINISTIC');
    expect(s.reason).toMatch(/No AI provider/);
  });
  it('deterministic title cleanup strips supplier noise without inventing content', () => {
    expect(deterministicTitleCleanup('  Hot Sale  USB-C   Fast Charger 65W Free Shipping 2024 🔥 ')).toBe(
      'USB-C Fast Charger 65W'
    );
    const long = deterministicTitleCleanup('word '.repeat(40), 30);
    expect(long.length).toBeLessThanOrEqual(30);
    expect(long.endsWith('word')).toBe(true);
  });
});
