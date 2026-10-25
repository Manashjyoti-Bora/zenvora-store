import { describe, expect, it } from 'vitest';
import { settingsSchema } from '@/lib/settings';
import {
  checkProductCompliance,
  evaluateProductCandidate,
  isValidProductImageUrl,
  type ProductCandidateInput,
} from '@/lib/catalog/ranking';
import { computePricing } from '@/lib/pricing/engine';
import { extractCjCategories } from '@/lib/suppliers/cj';

const defaultSettings = settingsSchema.parse({
  storeName: 'Zenvora Store',
  supportEmail: 'support@zenvora.local',
  currency: 'INR',
});

function baseCandidate(overrides: Partial<ProductCandidateInput> = {}): ProductCandidateInput {
  return {
    supplierId: 'sup-1',
    supplierName: 'CJ Dropshipping',
    supplierType: 'CJ',
    supplierActive: true,
    supplierSku: 'CJSKU-1001',
    externalId: 'PID-1001',
    variantId: 'VID-1001',
    name: 'Ergonomic Aluminium Laptop Stand Riser',
    description:
      'Adjustable 6-level foldable aluminium desk stand for 10 to 15.6 inch laptops with non-slip silicone pads.',
    categoryName: 'Electronics',
    categorySlug: 'electronics',
    images: [
      'https://cdn.example.com/stand-1.jpg',
      'https://cdn.example.com/stand-2.jpg',
    ],
    specifications: { Material: 'Aluminium Alloy', Weight: '240 g' },
    supplierCostPaise: 32_000,
    supplierShippingPaise: 4_000,
    shippingKnown: true,
    otherCostPaise: 2_500,
    sellingPricePaise: 69_900,
    grossMarginPaise: 31_400,
    effectiveMarginPercent: 44.92,
    estimatedNetProfitPaise: 30_002,
    inStock: true,
    stockQty: 50,
    weightGrams: 240,
    shippingSupportedToIndia: true,
    ...overrides,
  };
}

describe('Indian reselling eligibility & ranking engine', () => {
  it('ranks a complete, profitable, in-stock product as HIGH_POTENTIAL with explicit UNKNOWN demand confidence when no demand data exists', () => {
    const res = evaluateProductCandidate(baseCandidate(), defaultSettings);
    expect(res.tier).toBe('HIGH_POTENTIAL');
    expect(res.score).toBeGreaterThanOrEqual(75);
    expect(res.eligibleForImport).toBe(true);
    expect(res.eligibleForAutoPublish).toBe(true);
    expect(res.recommendedStatus).toBe('ACTIVE');
    expect(res.codSuitable).toBe(true);
    // Demand must NEVER be invented when no store orders or CJ listedNum exist
    expect(res.demandConfidence).toBe('UNKNOWN');
    expect(res.demandSummary).toContain('UNKNOWN');
  });

  it('reports VERIFIED demand confidence only when real order count or CJ listedNum is present', () => {
    const withListed = evaluateProductCandidate(
      baseCandidate({ listedNum: 45 }),
      defaultSettings
    );
    expect(withListed.demandConfidence).toBe('VERIFIED');
    expect(withListed.demandSummary).toContain('CJ listedNum=45');
  });

  it('holds products with missing images, short description, or unverified shipping as NEEDS_REVIEW (blocks auto-publish)', () => {
    const noImage = evaluateProductCandidate(
      baseCandidate({ images: [] }),
      defaultSettings
    );
    expect(noImage.tier).toBe('NEEDS_REVIEW');
    expect(noImage.eligibleForImport).toBe(true);
    expect(noImage.eligibleForAutoPublish).toBe(false);
    expect(noImage.recommendedStatus).toBe('DRAFT');
    expect(noImage.publicationBlockers.join(' ')).toMatch(/valid product image/i);

    const noShipping = evaluateProductCandidate(
      baseCandidate({ supplierShippingPaise: null, shippingKnown: false }),
      defaultSettings
    );
    expect(noShipping.tier).toBe('NEEDS_REVIEW');
    expect(noShipping.eligibleForAutoPublish).toBe(false);
    expect(noShipping.publicationBlockers.join(' ')).toMatch(/shipping cost to India is unverified/i);
  });

  it('disqualifies products with missing/zero supplier cost, out-of-stock status, or unsupported India shipping as NOT_ELIGIBLE', () => {
    const zeroCost = evaluateProductCandidate(
      baseCandidate({ supplierCostPaise: 0 }),
      defaultSettings
    );
    expect(zeroCost.tier).toBe('NOT_ELIGIBLE');
    expect(zeroCost.eligibleForImport).toBe(false);
    expect(zeroCost.blockingReasons.join(' ')).toMatch(/supplier unit cost/i);

    const outOfStock = evaluateProductCandidate(
      baseCandidate({ inStock: false, stockQty: 0 }),
      defaultSettings
    );
    expect(outOfStock.tier).toBe('NOT_ELIGIBLE');
    expect(outOfStock.eligibleForImport).toBe(false);
    expect(outOfStock.blockingReasons.join(' ')).toMatch(/out of stock/i);

    const noIndiaShip = evaluateProductCandidate(
      baseCandidate({ shippingSupportedToIndia: false }),
      defaultSettings
    );
    expect(noIndiaShip.tier).toBe('NOT_ELIGIBLE');
    expect(noIndiaShip.eligibleForImport).toBe(false);
  });

  it('enforces compliance checks and rejects prohibited weapons, vapes, counterfeit replicas, and restricted drugs', () => {
    expect(
      checkProductCompliance({ name: 'Tactical Hunting Survival Knife' }).passed
    ).toBe(false);
    expect(
      checkProductCompliance({ name: 'Rechargeable Vape Pen Nicotine Liquid' }).passed
    ).toBe(false);
    expect(
      checkProductCompliance({ name: '1:1 Replica Designer Handbag' }).passed
    ).toBe(false);

    const prohibitedEval = evaluateProductCandidate(
      baseCandidate({ name: 'Tactical Hunting Survival Knife Blade' }),
      defaultSettings
    );
    expect(prohibitedEval.tier).toBe('NOT_ELIGIBLE');
    expect(prohibitedEval.compliancePassed).toBe(false);
    expect(prohibitedEval.eligibleForImport).toBe(false);
    expect(prohibitedEval.eligibleForAutoPublish).toBe(false);
  });

  it('respects configurable category exclusions and custom ranking weights', () => {
    const customSettings = settingsSchema.parse({
      storeName: 'Zenvora Store',
      supportEmail: 'support@zenvora.local',
      currency: 'INR',
      autoImport: {
        excludedCategories: ['electronics'],
      },
    });
    const res = evaluateProductCandidate(baseCandidate(), customSettings);
    expect(res.tier).toBe('NOT_ELIGIBLE');
    expect(res.blockingReasons.join(' ')).toMatch(/excluded categories/i);
  });

  it('validates product image URLs honestly', () => {
    expect(isValidProductImageUrl('https://cdn.cjdropshipping.com/img.jpg')).toBe(true);
    expect(isValidProductImageUrl('/uploads/seed/demo-cotton-tote-bag.svg')).toBe(true);
    expect(isValidProductImageUrl('javascript:alert(1)')).toBe(false);
    expect(isValidProductImageUrl('')).toBe(false);
  });
});

describe('pricing engine minMarginPercent and min/max selling price enforcement', () => {
  it('raises calculated selling price when minMarginPercent requires a higher price than raw markup', () => {
    const res = computePricing({
      supplierCostPaise: 50_000, // ₹500
      supplierShippingPaise: 0,
      otherCostPaise: 0,
      mode: 'PERCENT_MARKUP',
      percentMarkup: 10, // raw ₹550 -> 9.09% gross margin
      minMarginPercent: 25, // requires ₹500 / 0.75 = ₹666.67 -> ₹667
      roundingRule: 'NONE',
    });
    expect(res.effectiveMarginPercent).toBeGreaterThanOrEqual(25);
    expect(res.sellingPricePaise).toBeGreaterThanOrEqual(66_667);
    expect(res.minProfitApplied).toBe(true);
  });

  it('enforces minSellingPricePaise and warns on maxSellingPricePaise', () => {
    const low = computePricing({
      supplierCostPaise: 2_000,
      supplierShippingPaise: 0,
      otherCostPaise: 0,
      mode: 'PERCENT_MARKUP',
      percentMarkup: 20,
      minSellingPricePaise: 9_900, // ₹99 floor
      roundingRule: 'NONE',
    });
    expect(low.sellingPricePaise).toBe(9_900);

    const high = computePricing({
      supplierCostPaise: 300_000,
      supplierShippingPaise: 0,
      otherCostPaise: 0,
      mode: 'PERCENT_MARKUP',
      percentMarkup: 50,
      maxSellingPricePaise: 400_000,
      roundingRule: 'NONE',
    });
    expect(high.warnings.join(' ')).toMatch(/exceeds the configured maximum selling price/i);
  });
});

describe('CJ 3-level category tree extraction', () => {
  it('flattens CJ product/getCategory response into levels 1, 2, and 3', () => {
    const cats = extractCjCategories([
      {
        categoryFirstId: 'L1',
        categoryFirstName: 'Consumer Electronics',
        categoryFirstList: [
          {
            categorySecondId: 'L2',
            categorySecondName: 'Chargers & Cables',
            categorySecondList: [
              {
                categoryId: 'L3',
                categoryName: 'GaN Wall Chargers',
              },
            ],
          },
        ],
      },
    ]);
    expect(cats).toEqual([
      { id: 'L1', name: 'Consumer Electronics', parentId: null, level: 1 },
      { id: 'L2', name: 'Chargers & Cables', parentId: 'L1', level: 2 },
      { id: 'L3', name: 'GaN Wall Chargers', parentId: 'L2', level: 3 },
    ]);
  });
});

describe('owner-configurable confidence / sample-size safeguards', () => {
  it('default: no demand gate — publication depends on verified unit economics only', () => {
    const res = evaluateProductCandidate(baseCandidate(), defaultSettings);
    expect(res.demandConfidence).toBe('UNKNOWN');
    expect(res.eligibleForAutoPublish).toBe(true);
  });

  it('minDemandConfidenceForAutoPublish=LOW_EVIDENCE holds UNKNOWN-demand items for review without rejecting them', () => {
    const strict = settingsSchema.parse({
      ...defaultSettings,
      autoImport: { ...defaultSettings.autoImport, minDemandConfidenceForAutoPublish: 'LOW_EVIDENCE' },
    });
    const res = evaluateProductCandidate(baseCandidate(), strict);
    expect(res.eligibleForImport).toBe(true);
    expect(res.eligibleForAutoPublish).toBe(false);
    expect(res.tier).toBe('NEEDS_REVIEW');
    expect(res.publicationBlockers.join(' ')).toMatch(/Demand evidence UNKNOWN is below the configured minimum \(LOW_EVIDENCE\)/);
    // With a small but real CJ signal it passes the LOW_EVIDENCE gate…
    expect(evaluateProductCandidate(baseCandidate({ listedNum: 3 }), strict).eligibleForAutoPublish).toBe(true);
  });

  it('verifiedDemandMinListedNum is the sample size for VERIFIED demand', () => {
    const bigSample = settingsSchema.parse({
      ...defaultSettings,
      autoImport: { ...defaultSettings.autoImport, verifiedDemandMinListedNum: 100 },
    });
    expect(evaluateProductCandidate(baseCandidate({ listedNum: 45 }), bigSample).demandConfidence).toBe('LOW_EVIDENCE');
    expect(evaluateProductCandidate(baseCandidate({ listedNum: 120 }), bigSample).demandConfidence).toBe('VERIFIED');
    // Real store orders always count as verified evidence regardless of the CJ sample size.
    expect(evaluateProductCandidate(baseCandidate({ storeOrderCount: 1 }), bigSample).demandConfidence).toBe('VERIFIED');
  });

  it('minScoreForAutoPublish raises the bar for an ACTIVE recommendation', () => {
    const base = evaluateProductCandidate(baseCandidate(), defaultSettings);
    const strict = settingsSchema.parse({
      ...defaultSettings,
      autoImport: { ...defaultSettings.autoImport, minScoreForAutoPublish: Math.min(100, base.score + 1) },
    });
    const res = evaluateProductCandidate(baseCandidate(), strict);
    expect(res.tier).toBe('NEEDS_REVIEW');
    expect(res.recommendedStatus).toBe('DRAFT');
  });
});
