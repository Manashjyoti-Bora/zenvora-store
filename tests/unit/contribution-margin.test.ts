import { describe, expect, it } from 'vitest';
import { computeContributionMargin } from '@/lib/catalog/contribution-margin';

const base = {
  sellingPricePaise: 99_900, // ₹999 incl. 18% GST
  supplierCostPaise: 30_000,
  supplierShippingPaise: 12_000,
  taxRatePercent: 18,
  paymentFeePercent: 2,
  paymentFeeFixedPaise: 300,
  packagingPaise: 1_500,
  operationalPaise: 1_000,
  returnReservePercent: 5,
  otherKnownCostsPaise: 0,
};

describe('computeContributionMargin', () => {
  it('itemises every line and sums to the contribution', () => {
    const r = computeContributionMargin(base);
    const gst = Math.round(99_900 - 99_900 / 1.18); // 15 239
    expect(r.netRevenuePaise).toBe(99_900 - gst);
    const fee = Math.round(99_900 * 0.02 + 300); // 2 298
    const returnLoss = Math.round((30_000 + 12_000) * 0.05); // 2 100
    const expectedCost = 30_000 + 12_000 + fee + 2_500 + returnLoss;
    expect(r.totalCostPaise).toBe(expectedCost);
    expect(r.contributionPaise).toBe(r.netRevenuePaise - expectedCost);
    expect(r.contributionPercent).toBeCloseTo((r.contributionPaise / r.netRevenuePaise) * 100, 0);
    // Sum of signed lines equals the contribution (no hidden terms).
    expect(r.lines.reduce((a, l) => a + l.amountPaise, 0)).toBe(r.contributionPaise);
    expect(r.unknowns).toEqual([]);
    expect(r.isUpperBound).toBe(false);
  });

  it('labels estimates vs supplier quotes vs configuration honestly', () => {
    const r = computeContributionMargin(base);
    const basis = Object.fromEntries(r.lines.map((l) => [l.key, l.basis]));
    expect(basis.supplierCost).toBe('SUPPLIER_QUOTE');
    expect(basis.supplierShipping).toBe('SUPPLIER_QUOTE');
    expect(basis.paymentFees).toBe('ESTIMATE');
    expect(basis.estimatedReturnLoss).toBe('ESTIMATE');
    expect(basis.fulfilment).toBe('CONFIGURED');
    expect(r.lines.find((l) => l.key === 'estimatedReturnLoss')!.note).toMatch(/NOT a measured return rate/);
    expect(r.basisSummary.realized).toBe(0);
  });

  it('marks missing shipping/cost as UNKNOWN and flags the figure as an upper bound', () => {
    const r = computeContributionMargin({ ...base, supplierShippingPaise: null });
    expect(r.unknowns).toContain('supplier shipping');
    expect(r.isUpperBound).toBe(true);
    expect(r.lines.find((l) => l.key === 'supplierShipping')!.basis).toBe('UNKNOWN');
    const noCost = computeContributionMargin({ ...base, supplierCostPaise: null });
    expect(noCost.unknowns).toContain('supplier cost');
    expect(noCost.isUpperBound).toBe(true);
  });

  it('realised figures override estimates and are marked REALIZED', () => {
    const r = computeContributionMargin({
      ...base,
      realized: { paymentFeePaise: 2_000, supplierCostPaise: 31_000, supplierShippingPaise: 11_000 },
    });
    const by = Object.fromEntries(r.lines.map((l) => [l.key, l]));
    expect(by.paymentFees.basis).toBe('REALIZED');
    expect(by.paymentFees.amountPaise).toBe(-2_000);
    expect(by.supplierCost.amountPaise).toBe(-31_000);
    expect(by.supplierShipping.amountPaise).toBe(-11_000);
    // Return-loss provision follows the realised landed cost.
    expect(by.estimatedReturnLoss.amountPaise).toBe(-Math.round(42_000 * 0.05));
    expect(r.basisSummary.realized).toBe(3);
  });

  it('never produces NaN or negative percentages on zero revenue', () => {
    const r = computeContributionMargin({ ...base, sellingPricePaise: 0 });
    expect(r.netRevenuePaise).toBe(0);
    expect(r.contributionPercent).toBe(0);
    expect(Number.isFinite(r.contributionPaise)).toBe(true);
    expect(r.contributionPaise).toBeLessThan(0);
  });

  it('can go negative — loss-making candidates are reported as such, not clamped', () => {
    const r = computeContributionMargin({ ...base, sellingPricePaise: 40_000 });
    expect(r.contributionPaise).toBeLessThan(0);
    expect(r.contributionPercent).toBeLessThan(0);
  });
});
