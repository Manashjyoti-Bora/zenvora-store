export interface ListingEmptyStateInput {
  itemCount: number;
  total: number;
  page: number;
  totalPages: number;
  /** Unfiltered public eligible count, supplied when the current query is empty. */
  catalogTotal?: number;
  basePath: string;
  searchParams?: Record<string, string | undefined>;
  query?: string;
  category?: string;
  minPrice?: string;
  maxPrice?: string;
  inStockOnly?: boolean;
}

export interface ListingEmptyState {
  kind: 'catalog-empty' | 'no-results' | 'empty-page';
  title: string;
  description: string;
  actionHref: string;
  actionLabel: string;
}

function pageHref(
  basePath: string,
  searchParams: Record<string, string | undefined>,
  page: number
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value && key !== 'page') params.set(key, value);
  }
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return `${basePath}${query ? `?${query}` : ''}`;
}

const catalogEmptyState: ListingEmptyState = {
  kind: 'catalog-empty',
  title: 'No products are available yet',
  description:
    'No products are published for browsing yet. Listings appear after their supplier data, pricing, variants, availability and product details have been reviewed.',
  actionHref: '/auth/login?next=%2Fadmin%2Fsupplier-products',
  actionLabel: 'Store owner? Sign in',
};

/**
 * Keep a successful empty query distinct from both filtered no-results and an
 * out-of-range page. Database/API errors are handled by the route error
 * boundary; they must never be represented as an empty catalogue.
 */
export function getListingEmptyState(input: ListingEmptyStateInput): ListingEmptyState | null {
  if (input.itemCount > 0) return null;

  if (input.total > 0) {
    const lastPage = Math.max(1, Math.min(input.page, input.totalPages));
    return {
      kind: 'empty-page',
      title: 'No products on this page',
      description: `There are ${input.total} eligible product${input.total === 1 ? '' : 's'} in this listing. Return to page ${lastPage} to continue browsing.`,
      actionHref: pageHref(input.basePath, input.searchParams ?? {}, lastPage),
      actionLabel: lastPage === input.page ? 'Refresh this page' : `View page ${lastPage}`,
    };
  }

  const hasNarrowing = Boolean(
    input.query?.trim() || input.category || input.minPrice || input.maxPrice || input.inStockOnly
  );

  // Category pages and filtered searches can each be empty while the global
  // catalogue is also empty. Prefer the authoritative unfiltered count when
  // available so those cases aren't mislabeled as a filter mismatch.
  if (input.catalogTotal === 0 || (input.catalogTotal === undefined && !hasNarrowing)) {
    return catalogEmptyState;
  }

  if (hasNarrowing) {
    return {
      kind: 'no-results',
      title: 'No products match these selections',
      description: 'Try removing a filter or search term, or browse the full catalogue.',
      actionHref: '/shop',
      actionLabel: 'Browse all products',
    };
  }

  // A global product count can change between the listing query and this
  // optional count. Avoid claiming that the catalogue is empty in that race.
  return {
    kind: 'no-results',
    title: 'Products are temporarily unavailable',
    description: 'The catalogue changed while this page was loading. Refresh to check again.',
    actionHref: input.basePath,
    actionLabel: 'Refresh catalogue',
  };
}
