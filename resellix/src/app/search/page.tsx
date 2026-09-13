import type { Metadata } from 'next';
import {
  listStorefrontProducts,
  listActiveCategories,
  parseSort,
  parsePriceBound,
} from '@/lib/catalog/storefront';
import { ProductGrid } from '@/components/store/product-grid';
import { FilterSidebar } from '@/components/store/filter-sidebar';
import { ListingControls } from '@/components/store/listing-controls';
import { Pagination } from '@/components/ui/table';
import { SearchForm } from '@/components/layout/search-form';

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

  return (
    <div className="container-store py-6 sm:py-8">
      <header className="mb-6 space-y-3">
        <div>
          <p className="eyebrow">Search</p>
          <h1 className="display mt-1.5">{q ? `Search results for “${q}”` : 'Search products'}</h1>
        </div>
        <div className="max-w-md">
          <SearchForm />
        </div>
        <p className="text-sm tabular-nums text-ink-400" aria-live="polite">
          {q
            ? `${result.total} result${result.total === 1 ? '' : 's'}`
            : `${result.total} products listed`}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr]">
        <div className="order-2 lg:order-1">
          <FilterSidebar
            categories={categories}
            basePath="/search"
            activeCategory={sp.category ?? null}
            searchParams={sp}
          />
        </div>
        <div className="order-1 min-w-0 lg:order-2">
          <div className="mb-4">
            <ListingControls />
          </div>
          <ProductGrid products={result.items} />
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
