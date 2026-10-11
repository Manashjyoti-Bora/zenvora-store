/**
 * Sitemap eligibility — which products may be advertised to crawlers.
 *
 * A product belongs in the sitemap only when it is genuinely purchasable-
 * eligible: published (ACTIVE) *and* priced above zero. An unpriced product is
 * either a draft in disguise or a pricing failure, and submitting it would
 * advertise a page that cannot be bought.
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

/** Prisma `where` fragment for the same rule (single source of truth). */
export const SITEMAP_PRODUCT_WHERE = {
  status: 'ACTIVE' as const,
  sellingPrice: { gt: '0' },
};
