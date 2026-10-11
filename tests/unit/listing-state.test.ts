import { describe, expect, it } from 'vitest';
import { getListingEmptyState } from '@/lib/catalog/listing-state';

const base = {
  itemCount: 0,
  total: 0,
  page: 1,
  totalPages: 1,
  basePath: '/shop',
};

describe('catalog listing empty states', () => {
  it('identifies a successfully loaded, genuinely empty catalogue', () => {
    expect(getListingEmptyState(base)).toMatchObject({
      kind: 'catalog-empty',
      title: 'No products are available yet',
      actionHref: '/auth/login?next=%2Fadmin%2Fsupplier-products',
    });
  });

  it('distinguishes a query with no matches from a globally empty catalogue', () => {
    expect(getListingEmptyState({ ...base, query: 'ceramic mug' })).toMatchObject({
      kind: 'no-results',
      actionHref: '/shop',
    });
    expect(getListingEmptyState({ ...base, inStockOnly: true })?.kind).toBe('no-results');
    expect(getListingEmptyState({ ...base, category: 'lighting' })?.kind).toBe('no-results');
  });

  it('uses the unfiltered eligible count to distinguish an empty category from an empty store', () => {
    expect(getListingEmptyState({ ...base, category: 'lighting', catalogTotal: 0 })?.kind).toBe(
      'catalog-empty'
    );
    expect(getListingEmptyState({ ...base, category: 'lighting', catalogTotal: 8 })?.kind).toBe(
      'no-results'
    );
  });

  it('recovers from an out-of-range page without discarding filters or sort', () => {
    const state = getListingEmptyState({
      ...base,
      total: 25,
      page: 9,
      totalPages: 3,
      searchParams: { q: 'lamp', category: 'lighting', sort: 'newest', page: '9' },
    });

    expect(state).toMatchObject({
      kind: 'empty-page',
      actionHref: '/shop?q=lamp&category=lighting&sort=newest&page=3',
      actionLabel: 'View page 3',
    });
  });

  it('does not render an empty state when the page has products', () => {
    expect(getListingEmptyState({ ...base, itemCount: 1, total: 1 })).toBeNull();
  });
});
