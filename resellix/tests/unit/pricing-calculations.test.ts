import { describe, expect, it } from 'vitest';
import {
  calculateCODImpact,
  calculateCost,
  calculateDiscount,
  calculateFinalPrice,
  calculateMargin,
  calculateMarkup,
  calculatePaymentFee,
  calculateProfit,
  calculateReturnReserve,
  calculateSellingPrice,
  minSafePricePaise,
  validateMinimumMargin,
} from '@/lib/pricing/calculations';
import type { StoreSettings } from '@/lib/settings';

function settings(over: Record<string, unknown> = {}): StoreSettings {
  return {
    storeName: 'Zenvora',
    storeTagline: '',
    supportEmail: 'support@zenvora.test',
    supportPhone: '',
    currency: 'INR',
    demoMode: false,
    announcement: null,
    business: {
      legalName: '',
      gstin: '',
      addressLine: '',
      city: '',
      state: '',
      postalCode: '',
    },
    payments: { feePercent: 2, feeFixedPaise: 0 },
    pricing: {
      minMarginPercent: 10,
      marginProtectionEnabled: true,
      returnReservePercent: 5,
      packagingPaise: 1000,
      operationalPaise: 500,
      maxDiscountPercent: 90,
    },
    shipping: {
      flatRatePaise: 4900,
      freeAbovePaise: 99900,
      codEnabled: true,
      codFeePaise: 3000,
      estimatedDaysMin: 3,
      estimatedDaysMax: 7,
    },
    policies: {
      returnWindowDays: 7,
      cancellationWindowHours: 24,
    },
    ...over,
  } as unknown as StoreSettings;
}

describe('pricing facade: cost model', () => {
  it('calculateCost sums supplier, shipping, packaging, operational and reserve', () => {
    expect(
      calculateCost({
        supplierCostPaise: 50000,
        supplierShippingPaise: 5000,
        packagingPaise: 1000,
        operationalPaise: 500,
        returnReservePaise: 2750,
      })
    ).toBe(59250);
  });

  it('calculateReturnReserve applies the settings percent to landed cost', () => {
    expect(calculateReturnReserve(55000, settings())).toBe(2750); // 5%
  });

  it('markup and margin are different numbers for the same price', () => {
    // cost 600, price 799: markup 33.17%, margin 24.91%
    expect(calculateMarkup(60000, 79900)).toBe(33.17);
    expect(calculateMargin(60000, 79900)).toBe(24.91);
  });

  it('calculatePaymentFee + calculateProfit use settings gateway estimate', () => {
    const s = settings();
    expect(calculatePaymentFee(79900, s)).toBe(1598); // 2%
    expect(calculateProfit(60000, 79900, s)).toBe(79900 - 60000 - 1598);
  });

  it('calculateCODImpact respects codEnabled and payment method', () => {
    expect(calculateCODImpact(settings(), 'COD')).toBe(3000);
    expect(calculateCODImpact(settings(), 'PREPAID')).toBe(0);
    expect(
      calculateCODImpact(settings({ shipping: { ...settings().shipping, codEnabled: false } }), 'COD')
    ).toBe(0);
  });
});

describe('pricing facade: selling price', () => {
  it('target fixed profit reproduces the spec example (600 + 199 = 799)', () => {
    expect(
      calculateSellingPrice({ totalCostPaise: 60000, targetProfitPaise: 19900 })
    ).toBe(79900);
  });

  it('target margin percent solves price = cost / (1 - m)', () => {
    // cost 60000p, margin 30% -> ceil(60000/0.7) = 85715p
    expect(calculateSellingPrice({ totalCostPaise: 60000, targetMarginPercent: 30 })).toBe(85715);
  });

  it('rounding rules apply (psychological pricing)', () => {
    expect(
      calculateSellingPrice({ totalCostPaise: 60000, targetProfitPaise: 19100, roundingRule: 'NEAREST_99' })
    ).toBe(79900); // 791 -> 799
  });
});

describe('discounts + minimum-margin protection', () => {
  const s = settings();

  it('calculateDiscount caps at coupon cap and global maxDiscountPercent', () => {
    expect(
      calculateDiscount({ eligibleSubtotalPaise: 100000, type: 'PERCENT', valuePaise: 50, capPaise: 20000, settings: s })
    ).toBe(20000);
    expect(
      calculateDiscount({ eligibleSubtotalPaise: 100000, type: 'PERCENT', valuePaise: 95, settings: s })
    ).toBe(90000); // global 90% cap
  });

  it('minSafePrice = cost / (1 - minMargin%)', () => {
    expect(minSafePricePaise(80000, s)).toBe(Math.ceil(80000 / 0.9)); // 88889
  });

  it('calculateFinalPrice never drops below the floor unless bypassed', () => {
    const r = calculateFinalPrice({
      pricePaise: 100000,
      discountPaise: 50000,
      minSafePricePaise: 88889,
    });
    expect(r.finalPricePaise).toBe(88889);
    expect(r.appliedDiscountPaise).toBe(11111);
    expect(r.capped).toBe(true);
    const b = calculateFinalPrice({
      pricePaise: 100000,
      discountPaise: 50000,
      minSafePricePaise: 88889,
      bypassMarginProtection: true,
    });
    expect(b.finalPricePaise).toBe(50000);
    expect(b.capped).toBe(false);
  });

  it('validateMinimumMargin reports the allowed discount + floor', () => {
    const g = validateMinimumMargin({
      subtotalPaise: 100000,
      totalCostPaise: 80000,
      requestedDiscountPaise: 50000,
      bypass: false,
      settings: s,
    });
    expect(g.allowedDiscountPaise).toBe(100000 - 88889);
    expect(g.capped).toBe(true);
    expect(g.floorPaise).toBe(88889);
  });

  it('protection off => no cap', () => {
    const off = settings({
      pricing: { ...s.pricing, marginProtectionEnabled: false },
    });
    const g = validateMinimumMargin({
      subtotalPaise: 100000,
      totalCostPaise: 80000,
      requestedDiscountPaise: 50000,
      bypass: false,
      settings: off,
    });
    expect(g.allowedDiscountPaise).toBe(50000);
    expect(g.capped).toBe(false);
  });
});
