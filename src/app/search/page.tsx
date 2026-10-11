import type { Metadata } from 'next';
import {
  listStorefrontProducts,
  listActiveCategories,
  parseSort,
  parsePriceBound,
  countStorefrontProducts,
} from '@/lib/catalog/storefront';
import { ProductGrid } from '@/components/store/product-grid';
import { FilterSidebar } from '@/components/store/filter-sidebar';
import { ActiveFilterChips } from '@/components/store/active-filter-chips';
import { ListingControls } from '@/components/store/listing-controls';
import { Pagination } from '@/components/ui/table';
import { SearchForm } from '@/components/layout/search-form';
import { getListingEmptyState } from '@/lib/catalog/listing-state';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Search',
  robots: { index: false, follow: true },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const [result, categories] = await Promise.all([
    listStorefrontProducts({
      q: q || undefined,
      categorySlug: sp.category,
      sort: parseSort(sp.sort),
      page,
      minPricePaise: parsePriceBound(sp.min),
      maxPricePaise: parsePriceBound(sp.max),
      inStockOnly: sp.stock === '1',
      perPage: 24,
    }),
    listActiveCategories(),
  ]);

  const catalogTotal = result.total === 0 ? await countStorefrontProducts() : undefined;
  const emptyState = getListingEmptyState({
    itemCount: result.items.length,
    total: result.total,
    catalogTotal,
    page: result.page,
    totalPages: result.totalPages,
    basePath: '/search',
    searchParams: sp,
    query: q,
    category: sp.category,
    minPrice: sp.min,
    maxPrice: sp.max,
    inStockOnly: sp.stock === '1',
  });

  return (
    <div className="container-store py-6 sm:py-8">
      <header className="mb-5 space-y-3 rounded-2xl border border-ink-900/10 bg-white p-5 shadow-hair sm:mb-6 sm:p-7">
        <div>
          <p className="eyebrow">Search the catalogue</p>
          <h1 className="display mt-1.5">{q ? `Search results for “${q}”` : 'Search products'}</h1>
        </div>
        <div className="max-w-md">
          <SearchForm />
        </div>
        <p className="text-sm tabular-nums text-ink-500" role="status" aria-live="polite">
          {q
            ? `${result.total} result${result.total === 1 ? '' : 's'}`
            : `${result.total} products listed`}
        </p>
      </header>

      <ActiveFilterChips
        basePath="/search"
        searchParams={sp}
        categories={categories}
        activeCategory={sp.category ?? null}
      />

      <div className="mb-3 lg:hidden">
        <FilterSidebar
          presentation="mobile"
          categories={categories}
          basePath="/search"
          activeCategory={sp.category ?? null}
          searchParams={sp}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
        <div>
          <FilterSidebar
            presentation="desktop"
            categories={categories}
            basePath="/search"
            activeCategory={sp.category ?? null}
            searchParams={sp}
          />
        </div>
        <div className="min-w-0">
          <div className="border-ink-900/8 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white px-3.5 py-3 shadow-hair sm:px-4">
            <span className="text-xs font-medium text-ink-500">Sort and availability</span>
            <ListingControls />
          </div>
          <ProductGrid products={result.items} emptyState={emptyState} />
          <Pagination
            page={result.page}
            totalPages={result.totalPages}
            basePath="/search"
            searchParams={{
              q: sp.q,
              category: sp.category,
              sort: sp.sort,
              min: sp.min,
              max: sp.max,
              stock: sp.stock,
            }}
          />
        </div>
      </div>
    </div>
  );
}
