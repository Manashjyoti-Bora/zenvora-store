import { describe, expect, it } from 'vitest';
import {
  resolveAvailability,
  schemaAvailability,
  supplierFreshnessCutoff,
  SUPPLIER_SYNC_FRESHNESS_HOURS,
  type AvailabilityInput,
} from '@/lib/catalog/availability';

/**
 * The availability model is the single source of truth for what the storefront,
 * product page, cart and checkout may claim about stock. These tests pin the
 * rules that keep us honest:
 *   - a supplier-synced product is NEVER judged by the merchant stock counter,
 *   - a stale or missing supplier report is "unverified", not "in stock" and not
 *     a fabricated "sold out",
 *   - only a verified out-of-stock blocks purchase.
 */

const now = new Date('2026-10-11T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600e3);

function supplierInput(over: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    isActive: true,
    stockMode: 'SUPPLIER_SYNC',
    stock: 0,
    hasVariants: false,
    variants: [],
    lowStockThreshold: 5,
    supplier: null,
    now,
    ...over,
  };
}

describe('resolveAvailability — LOCAL products', () => {
  it('is sold out when the local counter reaches zero', () => {
    const a = resolveAvailability(
      supplierInput({ stockMode: 'LOCAL', stock: 0, supplier: null })
    );
    expect(a.state).toBe('OUT_OF_STOCK');
    expect(a.purchasable).toBe(false);
    expect(a.maxQuantity).toBe(0);
  });

  it('reports low stock at or below the threshold and caps the line', () => {
    const a = resolveAvailability(supplierInput({ stockMode: 'LOCAL', stock: 3 }));
    expect(a.state).toBe('LOW_STOCK');
    expect(a.purchasable).toBe(true);
    expect(a.maxQuantity).toBe(3);
  });

  it('sums active variant stock for variant products', () => {
    const a = resolveAvailability(
      supplierInput({
        stockMode: 'LOCAL',
        stock: 0,
        hasVariants: true,
        variants: [{ stock: 4 }, { stock: 6 }],
        lowStockThreshold: 2,
      })
    );
    expect(a.state).toBe('IN_STOCK');
    expect(a.maxQuantity).toBe(10);
  });

  it('ignores supplier data entirely for LOCAL products', () => {
    const a = resolveAvailability(
      supplierInput({
        stockMode: 'LOCAL',
        stock: 7,
        supplier: { inStock: false, stockQty: 0, lastSyncedAt: hoursAgo(1) },
      })
    );
    expect(a.state).toBe('IN_STOCK');
  });
});

describe('resolveAvailability — SUPPLIER_SYNC products', () => {
  it('never treats the (unsynced) merchant counter as availability', () => {
    const a = resolveAvailability(supplierInput({ stock: 99, supplier: null }));
    expect(a.state).toBe('UNVERIFIED');
    expect(a.purchasable).toBe(true);
    expect(a.maxQuantity).toBeNull();
  });

  it('blocks purchase when a FRESH supplier report says out of stock', () => {
    const a = resolveAvailability(
      supplierInput({
        supplier: { inStock: false, stockQty: 0, lastSyncedAt: hoursAgo(1) },
      })
    );
    expect(a.state).toBe('OUT_OF_STOCK');
    expect(a.purchasable).toBe(false);
    expect(a.supplierVerified).toBe(true);
  });

  it('blocks purchase when a fresh report shows zero quantity without a flag', () => {
    const a = resolveAvailability(
      supplierInput({ supplier: { inStock: null, stockQty: 0, lastSyncedAt: hoursAgo(2) } })
    );
    expect(a.state).toBe('OUT_OF_STOCK');
    expect(a.purchasable).toBe(false);
  });

  it('accepts a fresh positive report and caps the line to the reported quantity', () => {
    const a = resolveAvailability(
      supplierInput({ supplier: { inStock: true, stockQty: 40, lastSyncedAt: hoursAgo(3) } })
    );
    expect(a.state).toBe('IN_STOCK');
    expect(a.purchasable).toBe(true);
    expect(a.maxQuantity).toBe(40);
    expect(a.supplierVerified).toBe(true);
    expect(a.verifiedAtIso).toBe(hoursAgo(3).toISOString());
  });

  it('treats a small fresh quantity as low stock', () => {
    const a = resolveAvailability(
      supplierInput({ supplier: { inStock: true, stockQty: 3, lastSyncedAt: hoursAgo(1) } })
    );
    expect(a.state).toBe('LOW_STOCK');
    expect(a.maxQuantity).toBe(3);
  });

  it('trusts the in-stock flag when no quantity is reported', () => {
    const a = resolveAvailability(
      supplierInput({ supplier: { inStock: true, stockQty: null, lastSyncedAt: hoursAgo(1) } })
    );
    expect(a.state).toBe('IN_STOCK');
    expect(a.maxQuantity).toBeNull();
  });
});

describe('resolveAvailability — staleness and unknown data', () => {
  it('falls back to UNVERIFIED once the supplier report is stale', () => {
    const stale = hoursAgo(SUPPLIER_SYNC_FRESHNESS_HOURS + 1);
    const a = resolveAvailability(
      supplierInput({ supplier: { inStock: true, stockQty: 12, lastSyncedAt: stale } })
    );
    expect(a.state).toBe('UNVERIFIED');
    expect(a.purchasable).toBe(true);
    // The timestamp is still surfaced, so the UI can say how old it is.
    expect(a.verifiedAtIso).toBe(stale.toISOString());
  });

  it('does NOT keep an out-of-stock claim alive on stale data', () => {
    // Important: a stale "out of stock" must not keep a product un-buyable
    // forever — fulfilment re-checks the supplier, and a human can re-sync.
    const a = resolveAvailability(
      supplierInput({
        supplier: {
          inStock: false,
          stockQty: 0,
          lastSyncedAt: hoursAgo(SUPPLIER_SYNC_FRESHNESS_HOURS + 5),
        },
      })
    );
    expect(a.state).toBe('UNVERIFIED');
    expect(a.purchasable).toBe(true);
  });

  it('is UNVERIFIED when a fresh sync reported neither flag nor quantity', () => {
    const a = resolveAvailability(
      supplierInput({ supplier: { inStock: null, stockQty: null, lastSyncedAt: hoursAgo(1) } })
    );
    expect(a.state).toBe('UNVERIFIED');
    expect(a.supplierVerified).toBe(false);
  });

  it('respects an explicit freshness window', () => {
    const a = resolveAvailability(
      supplierInput({
        supplier: { inStock: true, stockQty: 5, lastSyncedAt: hoursAgo(10) },
        freshnessHours: 6,
      })
    );
    expect(a.state).toBe('UNVERIFIED');
  });

  it('rejects absurd future timestamps as not fresh', () => {
    const a = resolveAvailability(
      supplierInput({
        supplier: { inStock: true, stockQty: 5, lastSyncedAt: new Date(now.getTime() + 30 * 86400e3) },
      })
    );
    expect(a.state).toBe('UNVERIFIED');
  });

  it('tolerates small clock skew into the future', () => {
    const a = resolveAvailability(
      supplierInput({
        supplier: { inStock: true, stockQty: 50, lastSyncedAt: new Date(now.getTime() + 60e3) },
      })
    );
    expect(a.state).toBe('IN_STOCK');
  });
});

describe('resolveAvailability — inactive products', () => {
  it('is never purchasable', () => {
    const a = resolveAvailability(supplierInput({ isActive: false, stockMode: 'LOCAL', stock: 50 }));
    expect(a.state).toBe('OUT_OF_STOCK');
    expect(a.purchasable).toBe(false);
  });
});

describe('labels and structured data', () => {
  it('never claims "in stock" for unverified availability', () => {
    const a = resolveAvailability(supplierInput({ supplier: null }));
    expect(a.label.toLowerCase()).not.toContain('in stock');
    expect(schemaAvailability(a)).toBeUndefined();
  });

  it('maps verified states onto schema.org availability', () => {
    const inStock = resolveAvailability(
      supplierInput({ supplier: { inStock: true, stockQty: 9, lastSyncedAt: hoursAgo(1) } })
    );
    const out = resolveAvailability(
      supplierInput({ supplier: { inStock: false, stockQty: 0, lastSyncedAt: hoursAgo(1) } })
    );
    expect(schemaAvailability(inStock)).toBe('https://schema.org/InStock');
    expect(schemaAvailability(out)).toBe('https://schema.org/OutOfStock');
  });

  it('exposes a freshness cutoff consistent with the window', () => {
    const cutoff = supplierFreshnessCutoff(now, 24);
    expect(now.getTime() - cutoff.getTime()).toBe(24 * 3600e3);
  });
});
