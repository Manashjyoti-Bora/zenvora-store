import { describe, expect, it } from 'vitest';
import { isSitemapEligible, SITEMAP_PRODUCT_WHERE } from '@/lib/catalog/eligibility';

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

  it('keeps the Prisma filter in step with the predicate', () => {
    // The query and the predicate are the same rule; this pins the shared shape
    // so a future edit to one is caught by the other.
    expect(SITEMAP_PRODUCT_WHERE.status).toBe('ACTIVE');
    expect(SITEMAP_PRODUCT_WHERE.sellingPrice).toEqual({ gt: '0' });
  });
});
