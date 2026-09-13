import { describe, expect, it } from 'vitest';
import {
  computePricing,
  applyRounding,
  ceilToRupee,
  taxComponentOf,
  prorateDiscount,
} from '@/lib/pricing/engine';

const base = {
  supplierCostPaise: 10_000, // ₹100
  supplierShippingPaise: 0,
  otherCostPaise: 0,
  roundingRule: 'NONE' as const,
};

describe('PERCENT_MARKUP (markup on landed cost)', () => {
  it('adds markup on TOTAL landed cost, not just product cost', () => {
    const b = computePricing({
      ...base,
      supplierShippingPaise: 2_000,
      mode: 'PERCENT_MARKUP',
      percentMarkup: 40,
    });
    // landed cost 12000 → raw 12000 * 1.4 = 16800
    expect(b.totalCostPaise).toBe(12_000);
    expect(b.rawPricePaise).toBe(16_800);
    expect(b.sellingPricePaise).toBe(16_800);
    expect(b.grossMarginPaise).toBe(4_800);
  });

  it('distinguishes margin% from markup% (never conflates them)', () => {
    const b = computePricing({ ...base, mode: 'PERCENT_MARKUP', percentMarkup: 40 });
    expect(b.markupOnCostPercent).toBe(40); // on cost
    // margin on selling price = 4000/14000 = 28.57% — NOT 40%
    expect(b.effectiveMarginPercent).toBe(28.57);
    expect(b.effectiveMarginPercent).toBeLessThan(b.markupOnCostPercent!);
  });

  it('requires a non-negative percentMarkup', () => {
    expect(() => computePricing({ ...base, mode: 'PERCENT_MARKUP' })).toThrow();
    expect(() => computePricing({ ...base, mode: 'PERCENT_MARKUP', percentMarkup: -5 })).toThrow();
  });
});

describe('FIXED_MARGIN and FIXED_PRICE', () => {
  it('FIXED_MARGIN adds a fixed rupee margin to landed cost', () => {
    const b = computePricing({ ...base, mode: 'FIXED_MARGIN', fixedMarginPaise: 2_500 });
    expect(b.sellingPricePaise).toBe(12_500);
    expect(b.grossMarginPaise).toBe(2_500);
  });

  it('FIXED_MARGIN requires the margin', () => {
    expect(() => computePricing({ ...base, mode: 'FIXED_MARGIN' })).toThrow();
  });

  it('FIXED_PRICE uses the explicit price', () => {
    const b = computePricing({ ...base, mode: 'FIXED_PRICE', fixedPricePaise: 99_900 });
    expect(b.sellingPricePaise).toBe(99_900);
  });

  it('FIXED_PRICE requires the price', () => {
    expect(() => computePricing({ ...base, mode: 'FIXED_PRICE' })).toThrow();
  });
});

describe('rounding rules', () => {
  it('ROUND_UP_10 rounds up to the next ₹10', () => {
    expect(applyRounding(129_050, 'ROUND_UP_10')).toBe(130_000);
    expect(applyRounding(130_000, 'ROUND_UP_10')).toBe(130_000);
    expect(applyRounding(1, 'ROUND_UP_10')).toBe(1_000);
  });

  it('NEAREST_9 snaps to psychological x9 prices', () => {
    expect(applyRounding(39_100, 'NEAREST_9')).toBe(38_900);
    expect(applyRounding(39_500, 'NEAREST_9')).toBe(39_900);
    expect(applyRounding(40_000, 'NEAREST_9')).toBe(39_900);
  });

  it('NEAREST_99 snaps to x99 prices', () => {
    expect(applyRounding(46_000, 'NEAREST_99')).toBe(49_900);
    expect(applyRounding(39_900, 'NEAREST_99')).toBe(39_900);
  });

  it('NONE leaves prices untouched', () => {
    expect(applyRounding(12_345, 'NONE')).toBe(12_345);
  });

  it('ceilToRupee rounds up to whole rupees', () => {
    expect(ceilToRupee(10_050)).toBe(10_100);
    expect(ceilToRupee(10_000)).toBe(10_000);
  });
});

describe('minimum profit floor', () => {
  it('raises the price when margin would fall below the floor', () => {
    const b = computePricing({
      ...base,
      mode: 'PERCENT_MARKUP',
      percentMarkup: 5, // raw 10500, margin only ₹50
      minProfitPaise: 2_000,
    });
    expect(b.minProfitApplied).toBe(true);
    expect(b.sellingPricePaise).toBe(12_000);
    expect(b.grossMarginPaise).toBe(2_000);
    expect(b.warnings.some((w) => w.toLowerCase().includes('minimum profit'))).toBe(true);
  });

  it('does nothing when the margin already clears the floor', () => {
    const b = computePricing({
      ...base,
      mode: 'PERCENT_MARKUP',
      percentMarkup: 40,
      minProfitPaise: 2_000,
    });
    expect(b.minProfitApplied).toBe(false);
    expect(b.sellingPricePaise).toBe(14_000);
  });
});

describe('below-cost protection', () => {
  it('flags FIXED_PRICE below landed cost with a warning (never silently)', () => {
    const b = computePricing({ ...base, mode: 'FIXED_PRICE', fixedPricePaise: 5_000 });
    expect(b.belowCost).toBe(true);
    expect(b.grossMarginPaise).toBe(-5_000);
    expect(b.warnings.some((w) => w.includes('BELOW'))).toBe(true);
  });

  it('enforces the ₹1 minimum selling price', () => {
    const b = computePricing({ ...base, mode: 'FIXED_PRICE', fixedPricePaise: 50 });
    expect(b.sellingPricePaise).toBeGreaterThanOrEqual(100);
    expect(b.warnings.length).toBeGreaterThan(0);
  });
});

describe('estimated payment fees & net profit forecast', () => {
  it('subtracts estimated gateway fees from gross margin', () => {
    const b = computePricing({
      ...base,
      mode: 'PERCENT_MARKUP',
      percentMarkup: 40,
      paymentFeePercent: 2,
      paymentFeeFixedPaise: 300,
    });
    // selling 14000 → fee 2% (280) + 300 = 580
    expect(b.estimatedPaymentFeePaise).toBe(580);
    expect(b.estimatedNetProfitPaise).toBe(4_000 - 580);
  });

  it('warns when fees would erase the profit (still positive gross margin)', () => {
    const b = computePricing({
      ...base,
      mode: 'PERCENT_MARKUP',
      percentMarkup: 1, // gross margin ₹1
      paymentFeePercent: 2,
      paymentFeeFixedPaise: 300,
    });
    expect(b.grossMarginPaise).toBeGreaterThan(0);
    expect(b.estimatedNetProfitPaise).toBeLessThan(0);
    expect(b.warnings.some((w) => w.toLowerCase().includes('negative'))).toBe(true);
  });
});

describe('tax (GST-inclusive convention)', () => {
  it('extracts the tax component from a tax-inclusive price', () => {
    expect(taxComponentOf(11_800, 18)).toBe(1_800); // ₹118 incl. 18% GST = ₹18 tax
    expect(taxComponentOf(10_500, 5)).toBe(500);
    expect(taxComponentOf(10_000, 0)).toBe(0);
  });

  it('computePricing reports the same tax component', () => {
    const b = computePricing({
      ...base,
      mode: 'FIXED_PRICE',
      fixedPricePaise: 11_800,
      taxRatePercent: 18,
    });
    expect(b.taxComponentPaise).toBe(1_800);
  });
});

describe('prorateDiscount', () => {
  it('splits a discount proportionally with exact sums', () => {
    const shares = prorateDiscount([5_000, 3_000, 2_000], 1_000);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(1_000);
    expect(shares[0]).toBeGreaterThanOrEqual(shares[1]!);
  });

  it('caps at the line total and handles empty/zero cases', () => {
    expect(prorateDiscount([1_000], 5_000).reduce((a, b) => a + b, 0)).toBe(1_000);
    expect(prorateDiscount([], 500)).toEqual([]);
    expect(prorateDiscount([1_000], 0)).toEqual([0]);
  });

  it('keeps integer paise even for awkward splits', () => {
    const shares = prorateDiscount([333, 333, 334], 100);
    expect(shares.every(Number.isInteger)).toBe(true);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe('input guards', () => {
  it('rejects negative costs and fractional paise', () => {
    expect(() =>
      computePricing({ ...base, supplierCostPaise: -1, mode: 'PERCENT_MARKUP', percentMarkup: 10 })
    ).toThrow();
    expect(() =>
      computePricing({
        ...base,
        supplierCostPaise: 10.5,
        mode: 'PERCENT_MARKUP',
        percentMarkup: 10,
      })
    ).toThrow();
  });
});
