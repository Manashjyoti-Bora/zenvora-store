/**
 * Public catalogue eligibility — the shared rule for the storefront, homepage,
 * product sitemap and admin diagnostics.
 *
 * A product is visible to customers only when it is published (ACTIVE) and
 * priced above zero. Unpriced records stay out of public listings because they
 * cannot be bought. Stock and category are separate, optional listing facets.
 */

export interface SitemapEligibilityInput {
  status: string;
  /** Selling price in paise (integer). */
  pricePaise: number | null | undefined;
}

export const SITEMAP_MIN_PRICE_PAISE = 1;

export function isSitemapEligible(product: SitemapEligibilityInput): boolean {
  if (product.status !== 'ACTIVE') return false;
  const price = product.pricePaise;
  if (price == null || !Number.isFinite(price)) return false;
  return price >= SITEMAP_MIN_PRICE_PAISE;
}

/** Prisma `where` fragment for the public catalogue rule (single source of truth). */
export const STOREFRONT_PRODUCT_WHERE = {
  status: 'ACTIVE' as const,
  sellingPrice: { gt: '0' },
};

/** Backward-compatible name for sitemap call sites. */
export const SITEMAP_PRODUCT_WHERE = STOREFRONT_PRODUCT_WHERE;
