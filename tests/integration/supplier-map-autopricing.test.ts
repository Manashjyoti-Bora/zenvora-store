import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { applyEnginePricingToProduct } from '@/lib/catalog/products';

/**
 * Auto-pricing after supplier-product mapping (spec: "when a product is
 * added/imported/mapped and costs are known, the system determines the selling
 * price from configured rules"):
 *  - rule/markup-driven products are repriced deterministically from the new
 *    cost, with a full explanation (floor, max safe discount, margin %, rule).
 *  - admin FIXED_PRICE overrides are preserved (never silently changed).
 */

const suffix = `ap${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let markupProductId: string;
let fixedProductId: string;

beforeAll(async () => {
  const markup = await prisma.product.create({
    data: {
      name: `Auto-price markup ${suffix}`,
      slug: `auto-price-markup-${suffix}`,
      description: 'fixture',
      status: 'ACTIVE',
      stockMode: 'LOCAL',
      stock: 10,
      pricingMode: 'PERCENT_MARKUP',
      percentMarkup: '30',
      supplierCost: '500.00',
      supplierShippingCost: '0.00',
      sellingPrice: '650.00', // 500 * 1.30
      roundingRule: 'NONE',
    },
  });
  markupProductId = markup.id;

  const fixed = await prisma.product.create({
    data: {
      name: `Auto-price fixed ${suffix}`,
      slug: `auto-price-fixed-${suffix}`,
      description: 'fixture',
      status: 'ACTIVE',
      stockMode: 'LOCAL',
      stock: 10,
      pricingMode: 'FIXED_PRICE',
      fixedPrice: '799.00',
      supplierCost: '500.00',
      sellingPrice: '799.00',
      roundingRule: 'NONE',
    },
  });
  fixedProductId = fixed.id;
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { id: { in: [markupProductId, fixedProductId] } } });
  await prisma.$disconnect();
});

describe('applyEnginePricingToProduct (mapping cost sync)', () => {
  it('reprices a markup-driven product when supplier cost changes', async () => {
    // Simulate the map route syncing a new supplier cost onto the product.
    await prisma.product.update({
      where: { id: markupProductId },
      data: { supplierCost: '600.00' },
    });

    const res = await applyEnginePricingToProduct(markupProductId);
    expect(res.oldPricePaise).toBe(65000);
    expect(res.newPricePaise).toBe(78000); // 600 * 1.30
    expect(res.applied).toBe(true);
    expect(res.marginPercent).toBeCloseTo(23.08, 1); // markup != margin
    expect(res.minSafePricePaise).toBeGreaterThan(0);
    expect(res.maxSafeDiscountPaise).toBe(Math.max(0, res.newPricePaise - res.minSafePricePaise));

    const row = await prisma.product.findUniqueOrThrow({ where: { id: markupProductId } });
    expect(Number(row.sellingPrice)).toBeCloseTo(780, 2);
  });

  it('is a no-op when the price already matches the engine result', async () => {
    const res = await applyEnginePricingToProduct(markupProductId);
    expect(res.applied).toBe(false);
    expect(res.newPricePaise).toBe(78000);
  });

  it('preserves an admin FIXED_PRICE override even when cost changes', async () => {
    await prisma.product.update({
      where: { id: fixedProductId },
      data: { supplierCost: '700.00' },
    });
    const res = await applyEnginePricingToProduct(fixedProductId);
    expect(res.newPricePaise).toBe(79900);
    expect(res.applied).toBe(false);
    const row = await prisma.product.findUniqueOrThrow({ where: { id: fixedProductId } });
    expect(Number(row.sellingPrice)).toBeCloseTo(799, 2);
    // The engine still reports honest economics for the admin.
    expect(res.marginPercent).toBeLessThan(20); // (799-700)/799 = 12.39%
  });
});

/**
 * Regression: a supplier entry with no usable cost must never reprice a live
 * product. Before this guard a zero/unknown cost flowed into the engine and
 * wrote ₹0.00 onto a published product.
 */
describe('applyEnginePricingToProduct — zero-cost protection', () => {
  it('keeps the existing price and reports why when the supplier cost is zero', async () => {
    const created = await prisma.product.create({
      data: {
        name: `Zero cost guard ${suffix}`,
        slug: `zero-cost-guard-${suffix}`,
        description: 'Integration-test fixture product for the zero-cost guard.',
        status: 'ACTIVE',
        stockMode: 'SUPPLIER_SYNC',
        supplierCost: '400.00',
        pricingMode: 'PERCENT_MARKUP',
        percentMarkup: '30',
        roundingRule: 'NONE',
        sellingPrice: '520.00', // 400 × 1.30
      },
    });

    try {
      // The supplier now reports an unusable cost (unknown → persisted as 0).
      await prisma.product.update({ where: { id: created.id }, data: { supplierCost: '0.00' } });
      const res = await applyEnginePricingToProduct(created.id);

      expect(res.applied).toBe(false);
      expect(res.warnings.join(' ')).toMatch(/landed supplier cost is zero or missing/i);

      const row = await prisma.product.findUniqueOrThrow({ where: { id: created.id } });
      expect(Number(row.sellingPrice)).toBeCloseTo(520, 2); // untouched
    } finally {
      await prisma.product.delete({ where: { id: created.id } });
    }
  });
});
