import type { Metadata } from 'next';
import { getSettings } from '@/lib/settings';
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
import { getListingEmptyState } from '@/lib/catalog/listing-state';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return {
    title: 'Shop all products',
    description: `Browse the full ${settings.storeName} catalog. Transparent ₹ pricing, secure checkout and pan-India delivery.`,
    alternates: { canonical: '/shop' },
  };
}

export interface ListingSearchParams {
  [key: string]: string | undefined;
  q?: string;
  category?: string;
  sort?: string;
  page?: string;
  min?: string;
  max?: string;
  stock?: string;
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<ListingSearchParams>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);

  const [result, categories] = await Promise.all([
    listStorefrontProducts({
      q: params.q,
      categorySlug: params.category,
      sort: parseSort(params.sort),
      page,
      minPricePaise: parsePriceBound(params.min),
      maxPricePaise: parsePriceBound(params.max),
      inStockOnly: params.stock === '1',
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
    basePath: '/shop',
    searchParams: params,
    query: params.q,
    category: params.category,
    minPrice: params.min,
    maxPrice: params.max,
    inStockOnly: params.stock === '1',
  });

  return (
    <div className="container-store py-6 sm:py-8">
      <header className="mb-5 rounded-2xl border border-ink-900/10 bg-white p-5 shadow-hair sm:mb-6 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">The Zenvora catalogue</p>
            <h1 className="display mt-1.5">Shop all products</h1>
          </div>
          <p
            className="rounded-full border border-ink-900/10 bg-cream-50 px-3 py-1.5 text-sm font-medium tabular-nums text-ink-600"
            role="status"
            aria-live="polite"
          >
            {result.total} product{result.total === 1 ? '' : 's'}
            {params.category ? ` · ${params.category}` : ''}
          </p>
        </div>
      </header>

      <ActiveFilterChips
        basePath="/shop"
        searchParams={params}
        categories={categories}
        activeCategory={params.category ?? null}
      />

      <div className="mb-3 lg:hidden">
        <FilterSidebar
          presentation="mobile"
          categories={categories}
          basePath="/shop"
          activeCategory={params.category ?? null}
          searchParams={params}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
        <div>
          <FilterSidebar
            presentation="desktop"
            categories={categories}
            basePath="/shop"
            activeCategory={params.category ?? null}
            searchParams={params}
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
            basePath="/shop"
            searchParams={{
              q: params.q,
              category: params.category,
              sort: params.sort,
              min: params.min,
              max: params.max,
              stock: params.stock,
            }}
          />
        </div>
      </div>
    </div>
  );
}
