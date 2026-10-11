import { describe, expect, it, vi } from 'vitest';
import { catalogPathsFor, revalidateCatalog } from '@/lib/catalog/revalidate';

/**
 * Cache invalidation paths for catalog changes. Every storefront route is
 * force-dynamic today, so this is defensive — but it must be correct if any
 * segment is ever cached, and it must never break the mutation that triggered it.
 */
describe('catalogPathsFor', () => {
  it('always covers the landing surfaces and sitemap', () => {
    const paths = catalogPathsFor({});
    expect(paths).toEqual(expect.arrayContaining(['/', '/shop', '/search', '/sitemap.xml']));
  });

  it('adds the product and category pages that changed', () => {
    const paths = catalogPathsFor({
      productSlugs: ['wireless-mouse', 'usb-hub'],
      categorySlugs: ['electronics'],
    });
    expect(paths).toContain('/products/wireless-mouse');
    expect(paths).toContain('/products/usb-hub');
    expect(paths).toContain('/categories/electronics');
  });

  it('deduplicates and skips empty slugs', () => {
    const paths = catalogPathsFor({ productSlugs: ['a', 'a', ''] });
    expect(paths.filter((p) => p === '/products/a')).toHaveLength(1);
    expect(paths).not.toContain('/products/');
  });

  it('can skip the landing surfaces for a narrow change', () => {
    const paths = catalogPathsFor({ productSlugs: ['a'], includeLanding: false });
    expect(paths).toEqual(['/products/a']);
  });
});

describe('revalidateCatalog', () => {
  it('calls the revalidator once per path', () => {
    const spy = vi.fn();
    const applied = revalidateCatalog({ productSlugs: ['mouse'] }, spy);
    expect(spy).toHaveBeenCalledWith('/products/mouse', 'page');
    expect(applied).toContain('/products/mouse');
    expect(spy).toHaveBeenCalledTimes(applied.length);
  });

  it('never throws when invalidation fails (the write already succeeded)', () => {
    const boom = vi.fn(() => {
      throw new Error('outside request scope');
    });
    expect(() => revalidateCatalog({ productSlugs: ['mouse'] }, boom)).not.toThrow();
    expect(revalidateCatalog({ productSlugs: ['mouse'] }, boom)).toEqual([]);
  });

  it('keeps going after a single path fails', () => {
    let calls = 0;
    const flaky = vi.fn(() => {
      calls += 1;
      if (calls === 1) throw new Error('transient');
    });
    const applied = revalidateCatalog({ productSlugs: ['mouse'] }, flaky);
    expect(flaky.mock.calls.length).toBeGreaterThan(1);
    expect(applied.length).toBe(flaky.mock.calls.length - 1);
  });
});
