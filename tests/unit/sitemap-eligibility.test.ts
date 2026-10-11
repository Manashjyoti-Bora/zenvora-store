import { describe, expect, it } from 'vitest';
import {
  isSitemapEligible,
  SITEMAP_PRODUCT_WHERE,
  STOREFRONT_PRODUCT_WHERE,
} from '@/lib/catalog/eligibility';

/**
 * Only genuinely published, priced products may be advertised to crawlers.
 * An unpriced product is a draft in disguise or a pricing failure; submitting
 * it would advertise a page nobody can buy.
 */
describe('isSitemapEligible', () => {
  it('includes an ACTIVE product with a real price', () => {
    expect(isSitemapEligible({ status: 'ACTIVE', pricePaise: 49900 })).toBe(true);
  });

  it('excludes DRAFT and ARCHIVED products', () => {
    expect(isSitemapEligible({ status: 'DRAFT', pricePaise: 49900 })).toBe(false);
    expect(isSitemapEligible({ status: 'ARCHIVED', pricePaise: 49900 })).toBe(false);
  });

  it('excludes ACTIVE products with no usable price', () => {
    expect(isSitemapEligible({ status: 'ACTIVE', pricePaise: 0 })).toBe(false);
    expect(isSitemapEligible({ status: 'ACTIVE', pricePaise: null })).toBe(false);
    expect(isSitemapEligible({ status: 'ACTIVE', pricePaise: undefined })).toBe(false);
    expect(isSitemapEligible({ status: 'ACTIVE', pricePaise: Number.NaN })).toBe(false);
  });

  it('excludes a negative price', () => {
    expect(isSitemapEligible({ status: 'ACTIVE', pricePaise: -100 })).toBe(false);
  });

  it('shares one public eligibility filter between storefront and sitemap', () => {
    // The public listing/count query and sitemap use the same predicate so
    // ACTIVE-but-unpriced records cannot inflate the public product count.
    expect(STOREFRONT_PRODUCT_WHERE).toEqual({
      status: 'ACTIVE',
      sellingPrice: { gt: '0' },
    });
    expect(SITEMAP_PRODUCT_WHERE).toBe(STOREFRONT_PRODUCT_WHERE);
  });
});
