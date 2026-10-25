import { describe, expect, it } from 'vitest';
import { deriveLifecycleState, type LifecycleInput } from '@/lib/catalog/lifecycle';

const now = new Date('2026-10-25T12:00:00Z');
const fresh = new Date('2026-10-25T10:00:00Z');
const old = new Date('2026-10-20T10:00:00Z');

const ok = {
  eligibleForImport: true,
  eligibleForAutoPublish: true,
  blockingReasons: [] as string[],
  publicationBlockers: [] as string[],
};

function input(over: Partial<LifecycleInput> & { sp?: Partial<LifecycleInput['supplierProduct']> } = {}): LifecycleInput {
  const { sp, ...rest } = over;
  return {
    supplier: { isActive: true },
    supplierProduct: {
      isActive: true,
      inStock: true,
      stockQty: 25,
      lastSyncedAt: fresh,
      supplierCost: '300.00',
      supplierSku: 'SKU-1',
      ...sp,
    },
    product: null,
    importState: null,
    evaluation: ok,
    now,
    ...rest,
  };
}

describe('deriveLifecycleState', () => {
  it('DISCOVERED: synced, evaluated fine, not imported', () => {
    const r = deriveLifecycleState(input());
    expect(r.state).toBe('DISCOVERED');
    expect(r.isFresh).toBe(true);
    expect(r.freshnessHours).toBe(2);
    expect(r.sellable).toBe(false);
  });

  it('VALIDATION_FAILED when SKU or cost is missing (cannot price/dedupe)', () => {
    expect(deriveLifecycleState(input({ sp: { supplierSku: null } })).state).toBe('VALIDATION_FAILED');
    expect(deriveLifecycleState(input({ sp: { supplierCost: '0' } })).state).toBe('VALIDATION_FAILED');
  });

  it('REJECTED from the evaluator blocking reason, with the reason surfaced', () => {
    const r = deriveLifecycleState(
      input({
        evaluation: { ...ok, eligibleForImport: false, blockingReasons: ['Prohibited category: vape'] },
      })
    );
    expect(r.state).toBe('REJECTED');
    expect(r.reason).toContain('Prohibited');
  });

  it('NEEDS_REVIEW when import-eligible but a publication gate fails', () => {
    const r = deriveLifecycleState(
      input({ evaluation: { ...ok, eligibleForAutoPublish: false, publicationBlockers: ['No valid image'] } })
    );
    expect(r.state).toBe('NEEDS_REVIEW');
    expect(r.reason).toBe('No valid image');
  });

  it('APPROVED: draft in catalogue, passes all gates, auto-publish disabled → owner must publish', () => {
    const r = deriveLifecycleState(input({ product: { status: 'DRAFT' }, importState: { status: 'DRAFT' } }));
    expect(r.state).toBe('APPROVED');
    expect(r.reason).toMatch(/Automatic publishing is disabled/);
  });

  it('SCHEDULED only via the future publishAt hook (unreachable with today’s schema)', () => {
    const r = deriveLifecycleState(
      input({ product: { status: 'DRAFT', publishAt: new Date('2026-11-01T00:00:00Z') } })
    );
    expect(r.state).toBe('SCHEDULED');
  });

  it('ACTIVE / STALE / SUPPLIER_UNAVAILABLE for published products', () => {
    const active = deriveLifecycleState(input({ product: { status: 'ACTIVE' } }));
    expect(active.state).toBe('ACTIVE');
    expect(active.sellable).toBe(true);

    const stale = deriveLifecycleState(input({ product: { status: 'ACTIVE' }, sp: { lastSyncedAt: old } }));
    expect(stale.state).toBe('STALE');
    expect(stale.sellable).toBe(false);
    expect(stale.reason).toMatch(/122 h ago/);

    const never = deriveLifecycleState(input({ product: { status: 'ACTIVE' }, sp: { lastSyncedAt: null } }));
    expect(never.state).toBe('STALE');
    expect(never.freshnessHours).toBeNull();

    const oos = deriveLifecycleState(input({ product: { status: 'ACTIVE' }, sp: { inStock: false } }));
    expect(oos.state).toBe('SUPPLIER_UNAVAILABLE');
    const zero = deriveLifecycleState(input({ product: { status: 'ACTIVE' }, sp: { stockQty: 0 } }));
    expect(zero.state).toBe('SUPPLIER_UNAVAILABLE');
  });

  it('respects an owner-configured staleness window', () => {
    const r = deriveLifecycleState(
      input({ product: { status: 'ACTIVE' }, sp: { lastSyncedAt: old }, staleAfterHours: 24 * 7 })
    );
    expect(r.state).toBe('ACTIVE');
  });

  it('PAUSED wins over everything when the supplier or row is deactivated, or the product archived', () => {
    expect(deriveLifecycleState(input({ supplier: { isActive: false }, product: { status: 'ACTIVE' } })).state).toBe('PAUSED');
    expect(deriveLifecycleState(input({ sp: { isActive: false }, product: { status: 'ACTIVE' } })).state).toBe('PAUSED');
    expect(deriveLifecycleState(input({ product: { status: 'ARCHIVED' } })).state).toBe('PAUSED');
  });

  it('IMPORTING when an import was recorded but no product row is linked', () => {
    const r = deriveLifecycleState(input({ importState: { status: 'DRAFT' } }));
    expect(r.state).toBe('IMPORTING');
  });
});
