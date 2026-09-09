import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { evaluateCoupon } from '@/lib/checkout/coupons';

/**
 * Margin protection: a coupon must never push the effective price below the
 * configured minimum margin floor (settings.pricing.minMarginPercent, default
 * 10%) unless the coupon carries bypassMarginProtection=true.
 *
 * Fixture math: subtotal ₹1000 (100000p), total cost ₹800 (80000p).
 * Floor = ceil(80000 / 0.9) = 88889p => max allowed discount = 11111p.
 */

const CODES = ['MPTEST50A', 'MPTEST50B', 'MPFIXEDX'];

afterAll(async () => {
  await prisma.coupon.deleteMany({ where: { code: { in: CODES } } });
  await prisma.$disconnect();
});

async function makeCoupon(code: string, bypass: boolean, type: 'PERCENT' | 'FIXED', value: string) {
  await prisma.coupon.deleteMany({ where: { code } });
  return prisma.coupon.create({
    data: {
      code,
      description: 'margin protection test',
      type,
      value,
      scope: 'ALL_PRODUCTS',
      isActive: true,
      bypassMarginProtection: bypass,
    },
  });
}

describe('coupon margin protection', () => {
  it('caps a 50% coupon at the margin floor', async () => {
    await makeCoupon('MPTEST50A', false, 'PERCENT', '50');
    const res = await evaluateCoupon({
      code: 'MPTEST50A',
      subtotalPaise: 100000,
      eligiblePaise: 100000,
      totalCostPaise: 80000,
      userId: null,
      guestEmail: null,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.discountPaise).toBe(11111); // 100000 - 88889
      expect(res.discountPaise).toBeLessThan(50000); // never the full 50%
    }
  });

  it('applies the full discount when bypassMarginProtection is set', async () => {
    await makeCoupon('MPTEST50B', true, 'PERCENT', '50');
    const res = await evaluateCoupon({
      code: 'MPTEST50B',
      subtotalPaise: 100000,
      eligiblePaise: 100000,
      totalCostPaise: 80000,
      userId: null,
      guestEmail: null,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.discountPaise).toBe(50000);
  });

  it('rejects a fixed coupon that would eat the entire margin', async () => {
    await makeCoupon('MPFIXEDX', false, 'FIXED', '990'); // ₹990 off ₹1000
    const res = await evaluateCoupon({
      code: 'MPFIXEDX',
      subtotalPaise: 100000,
      eligiblePaise: 100000,
      totalCostPaise: 99000, // floor = ceil(99000/0.9) = 110000 > subtotal
      userId: null,
      guestEmail: null,
    });
    expect(res.ok).toBe(false);
  });

  it('leaves coupons untouched when total cost is unknown (no data => no silent cap)', async () => {
    await makeCoupon('MPTEST50A', false, 'PERCENT', '50');
    const res = await evaluateCoupon({
      code: 'MPTEST50A',
      subtotalPaise: 100000,
      eligiblePaise: 100000,
      userId: null,
      guestEmail: null,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.discountPaise).toBe(50000);
  });
});
