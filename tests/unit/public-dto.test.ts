import { describe, expect, it } from 'vitest';
import {
  findPrivateFields,
  toPublicProductDto,
  type PublicProductSource,
} from '@/lib/catalog/public-dto';
import { resolveAvailability } from '@/lib/catalog/availability';

/**
 * The public DTO is the boundary that keeps supplier costs, margins and pricing
 * internals out of anything a customer, crawler or API consumer can see. These
 * tests fail if a private field ever becomes reachable from a public payload.
 */

const source: PublicProductSource = {
  id: 'prod_1',
  slug: 'wireless-mouse',
  name: 'Wireless Mouse',
  brand: 'BrandX',
  sku: 'PUB-1',
  description: 'A mouse with a description long enough to be real.',
  shortDescription: 'Ergonomic mouse',
  seoTitle: 'Wireless Mouse | Zenvora',
  seoDescription: 'Buy the wireless mouse.',
  weightGrams: 250,
  taxRatePercent: '18.0000',
  compareAtPrice: '699.00',
  hasVariants: true,
  images: [{ url: 'https://cdn.example/mouse.jpg', alt: 'Mouse' }],
  category: { name: 'Electronics', slug: 'electronics' },
  variants: [
    {
      id: 'var_1',
      name: 'Black',
      size: null,
      color: 'Black',
      sellingPrice: '499.00',
      compareAtPrice: '699.00',
      isActive: true,
    },
    {
      id: 'var_2',
      name: 'Retired colour',
      size: null,
      color: 'Pink',
      sellingPrice: '499.00',
      compareAtPrice: null,
      isActive: false,
    },
  ],
};

/** A full-ish row as the storefront queries load it (private fields present). */
const rawRow = {
  ...source,
  supplierCost: '100.00',
  supplierShippingCost: '25.00',
  otherCost: '5.00',
  pricingMode: 'PERCENT_MARKUP',
  fixedPrice: null,
  fixedMargin: null,
  percentMarkup: '30.0000',
  minProfit: '50.00',
  roundingRule: 'ROUND_UP_10',
  supplierId: 'sup_1',
  supplierSku: 'CJ-123',
  stockMode: 'SUPPLIER_SYNC',
  stock: 0,
  viewCount: 42,
  lowStockThreshold: 5,
  status: 'ACTIVE',
  supplierProduct: {
    supplierSku: 'CJ-123',
    supplierCost: '100.00',
    inStock: true,
    stockQty: 12,
    lastSyncedAt: '2026-10-11T10:00:00.000Z',
  },
} as unknown as PublicProductSource;

describe('toPublicProductDto', () => {
  // SUPPLIER_SYNC availability is authoritative only while the supplier sync is
  // fresh (48h). `lastSyncedAt` is a literal date, so the evaluation clock must
  // be pinned too - otherwise this test silently rots 48h after it is written
  // and starts reporting UNVERIFIED instead of IN_STOCK. `now` is part of the
  // resolveAvailability contract for exactly this reason (see availability.test.ts).
  const now = new Date('2026-10-11T12:00:00.000Z');
  const availability = resolveAvailability({
    isActive: true,
    stockMode: 'SUPPLIER_SYNC',
    stock: 0,
    hasVariants: true,
    variants: [{ stock: 0 }, { stock: 0 }],
    lowStockThreshold: 5,
    supplier: { inStock: true, stockQty: 12, lastSyncedAt: new Date('2026-10-11T10:00:00.000Z') },
    now,
  });
  const dto = toPublicProductDto(rawRow, 49900, availability);

  it('carries the public shopping fields', () => {
    expect(dto.name).toBe('Wireless Mouse');
    expect(dto.pricePaise).toBe(49900);
    expect(dto.compareAtPricePaise).toBe(69900);
    expect(dto.images).toHaveLength(1);
    expect(dto.category).toEqual({ name: 'Electronics', slug: 'electronics' });
    expect(dto.taxRatePercent).toBe(18);
    expect(dto.availability.state).toBe('IN_STOCK');
  });

  it('excludes inactive variants', () => {
    expect(dto.variants.map((v) => v.id)).toEqual(['var_1']);
  });

  it('exposes no supplier cost, margin or pricing-strategy field', () => {
    const leaked = findPrivateFields(dto);
    expect(leaked).toEqual([]);
  });

  it('still detects a leak when one is introduced (guard is real)', () => {
    const leaky = { ...dto, supplierCost: '100.00' } as unknown;
    expect(findPrivateFields(leaky)).toContain('supplierCost');
  });

  it('never claims variant stock that is not verified', () => {
    const unverified = toPublicProductDto(
      rawRow,
      49900,
      resolveAvailability({
        isActive: true,
        stockMode: 'SUPPLIER_SYNC',
        stock: 0,
        hasVariants: true,
        variants: [{ stock: 0 }],
        lowStockThreshold: 5,
        supplier: null,
      })
    );
    expect(unverified.availability.state).toBe('UNVERIFIED');
    expect(unverified.variants.every((v) => v.inStockClaim === 'UNKNOWN')).toBe(true);
  });

  it('serialises to JSON without private keys', () => {
    const json = JSON.stringify(dto);
    for (const key of ['supplierCost', 'percentMarkup', 'fixedMargin', 'otherCost', 'viewCount']) {
      expect(json).not.toContain(key);
    }
  });
});
