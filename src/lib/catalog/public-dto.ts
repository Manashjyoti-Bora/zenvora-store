import type { Availability } from './availability';

/**
 * Public product DTO — the whitelist boundary between the database row and
 * anything a browser, crawler or API consumer can see.
 *
 * Storefront reads load the FULL product row (the pricing engine, margin
 * protection and supplier sync all need cost fields server-side). Those fields
 * must never reach a public response or a client component, and "remember not
 * to pass it" is not a control. Everything public is therefore derived through
 * this mapper, which copies an explicit list of fields and drops the rest.
 *
 * Private (never public): supplierCost, supplierShippingCost, otherCost,
 * pricingMode, fixedPrice, fixedMargin, percentMarkup, minProfit, roundingRule,
 * supplierId, supplierSku, supplierProduct.* (raw/cost/inStock timestamps),
 * viewCount, stockMode, and the merchant stock counter.
 */

export interface PublicProductVariant {
  id: string;
  name: string;
  size: string | null;
  color: string | null;
  pricePaise: number | null;
  compareAtPricePaise: number | null;
  inStockClaim: 'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN';
}

export interface PublicProductDto {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  sku: string | null;
  description: string;
  shortDescription: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  images: Array<{ url: string; alt: string | null }>;
  category: { name: string; slug: string } | null;
  pricePaise: number;
  compareAtPricePaise: number | null;
  hasVariants: boolean;
  variants: PublicProductVariant[];
  /** Public spec sheet fields (already displayed on the product page). */
  weightGrams: number | null;
  taxRatePercent: number;
  availability: Availability;
}

/** Shape accepted by the mapper: a storefront/detail product row. */
export interface PublicProductSource {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  sku: string | null;
  description: string;
  shortDescription: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  weightGrams: number | null;
  taxRatePercent: unknown; // Prisma Decimal
  compareAtPrice: unknown | null; // Prisma Decimal
  hasVariants: boolean;
  images: Array<{ url: string; alt: string | null }>;
  category: { name: string; slug: string } | null;
  variants: Array<{
    id: string;
    name: string;
    size: string | null;
    color: string | null;
    sellingPrice: unknown | null; // Prisma Decimal
    compareAtPrice: unknown | null; // Prisma Decimal
    isActive: boolean;
  }>;
}

const decimalToPaise = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
};

export function toPublicProductDto(
  product: PublicProductSource,
  pricePaise: number,
  availability: Availability
): PublicProductDto {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    brand: product.brand,
    sku: product.sku,
    description: product.description,
    shortDescription: product.shortDescription,
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    images: product.images.map((i) => ({ url: i.url, alt: i.alt })),
    category: product.category ? { name: product.category.name, slug: product.category.slug } : null,
    pricePaise,
    compareAtPricePaise: decimalToPaise(product.compareAtPrice),
    hasVariants: product.hasVariants,
    variants: product.variants
      .filter((v) => v.isActive)
      .map((v) => ({
        id: v.id,
        name: v.name,
        size: v.size,
        color: v.color,
        pricePaise: decimalToPaise(v.sellingPrice),
        compareAtPricePaise: decimalToPaise(v.compareAtPrice),
        // A variant never claims stock it cannot verify.
        inStockClaim:
          availability.state === 'OUT_OF_STOCK'
            ? 'OUT_OF_STOCK'
            : availability.state === 'UNVERIFIED'
              ? 'UNKNOWN'
              : 'IN_STOCK',
      })),
    weightGrams: product.weightGrams,
    taxRatePercent: Number(product.taxRatePercent ?? 0),
    availability,
  };
}

/** Field names that must never appear in a public payload (regression guard). */
export const PRIVATE_PRODUCT_FIELDS = [
  'supplierCost',
  'supplierShippingCost',
  'otherCost',
  'pricingMode',
  'fixedPrice',
  'fixedMargin',
  'percentMarkup',
  'minProfit',
  'roundingRule',
  'supplierId',
  'supplierSku',
  'supplierProduct',
  'viewCount',
  'stockMode',
  'stock',
  'landedCostPaise',
  'estimatedNetProfitPaise',
  'marginPercent',
] as const;

/** Recursively check a payload for any private field name. Used by tests. */
export function findPrivateFields(payload: unknown): string[] {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if ((PRIVATE_PRODUCT_FIELDS as readonly string[]).includes(key)) found.add(key);
        walk(child);
      }
    }
  };
  walk(payload);
  return [...found];
}
