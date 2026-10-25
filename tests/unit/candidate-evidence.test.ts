import { describe, expect, it } from 'vitest';
import { buildCandidateEvidence } from '@/lib/catalog/candidate-evidence';

const now = new Date('2026-10-25T12:00:00Z');
const base = {
  supplier: { name: 'CJ', slug: 'cj', type: 'CJ' },
  supplierProduct: {
    supplierSku: 'CJ-1',
    externalId: 'ext-1',
    supplierCost: '450.00',
    supplierShippingCost: '120.00',
    currency: 'INR',
    stockQty: 40,
    inStock: true,
    lastSyncedAt: new Date('2026-10-25T06:00:00Z'),
  },
  meta: {
    name: 'Ceramic pour-over set',
    description: 'A 12-piece hand-glazed ceramic pour-over set for home brewing.',
    categoryName: 'Home & Kitchen',
    images: ['https://img.example/1.jpg'],
    weightGrams: 900,
    listedNum: 320,
    shippingSupportedToIndia: true,
  },
  staleAfterHours: 48,
  now,
};

describe('buildCandidateEvidence', () => {
  it('rates a fresh, complete, supplier-backed candidate HIGH with verified cost', () => {
    const e = buildCandidateEvidence(base);
    expect(e.freshness).toBe('FRESH');
    expect(e.ageHours).toBe(6);
    expect(e.cost.verified).toBe(true);
    expect(e.cost.supplierCostPaise).toBe(45000);
    expect(e.cost.shippingPaise).toBe(12000);
    expect(e.stock.evidence).toBe('SUPPLIER_REPORTED_QTY');
    expect(e.completeness.percent).toBe(100);
    expect(e.missingEvidence).toEqual([]);
    expect(e.confidence.level).toBe('HIGH');
    expect(e.source).toMatchObject({ supplierSlug: 'cj', externalId: 'ext-1', supplierSku: 'CJ-1' });
  });

  it('never-synced rows are LOW confidence with unverified cost, whatever else is present', () => {
    const e = buildCandidateEvidence({
      ...base,
      supplierProduct: { ...base.supplierProduct, lastSyncedAt: null },
    });
    expect(e.freshness).toBe('NEVER_SYNCED');
    expect(e.fetchedAt).toBeNull();
    expect(e.cost.verified).toBe(false);
    expect(e.confidence.level).toBe('LOW');
    expect(e.missingEvidence[0]).toMatch(/never been synced/i);
  });

  it('stale rows past staleAfterHours are LOW and say how old the sync is', () => {
    const e = buildCandidateEvidence({
      ...base,
      supplierProduct: { ...base.supplierProduct, lastSyncedAt: new Date('2026-10-20T12:00:00Z') },
    });
    expect(e.freshness).toBe('STALE');
    expect(e.ageHours).toBe(120);
    expect(e.confidence.level).toBe('LOW');
    expect(e.missingEvidence.join(' ')).toContain('120h old');
  });

  it('missing shipping cost / stock / India support downgrade to MEDIUM and are listed as missing evidence', () => {
    const e = buildCandidateEvidence({
      ...base,
      supplierProduct: { ...base.supplierProduct, supplierShippingCost: null, stockQty: null, inStock: null },
      meta: { ...base.meta, shippingSupportedToIndia: null },
    });
    expect(e.confidence.level).toBe('MEDIUM');
    expect(e.cost.shippingKnown).toBe(false);
    expect(e.cost.shippingPaise).toBeNull();
    expect(e.stock.evidence).toBe('UNKNOWN');
    expect(e.completeness.missing).toEqual(expect.arrayContaining(['shippingCost', 'stock', 'shipsToIndia']));
    expect(e.missingEvidence).toEqual(
      expect.arrayContaining([expect.stringMatching(/shipping cost/i), expect.stringMatching(/stock/i), expect.stringMatching(/India/i)])
    );
  });

  it('zero cost is LOW regardless of freshness and is reported as missing', () => {
    const e = buildCandidateEvidence({
      ...base,
      supplierProduct: { ...base.supplierProduct, supplierCost: '0' },
    });
    expect(e.cost.verified).toBe(false);
    expect(e.confidence.level).toBe('LOW');
    expect(e.completeness.missing).toContain('cost');
  });
});
