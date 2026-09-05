import type { Metadata } from 'next';
import { getSettings } from '@/lib/settings';
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

  return (
    <div className="container-store py-6 sm:py-8">
      <header className="mb-5">
        <h1>Shop all products</h1>
        <p className="mt-1 text-sm tabular-nums text-gray-500">
          {result.total} product{result.total === 1 ? '' : 's'}
          {params.category ? ` in ${params.category}` : ''}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr]">
        <div className="order-2 lg:order-1">
          <FilterSidebar
            categories={categories}
            basePath="/shop"
            activeCategory={params.category ?? null}
            searchParams={params}
          />
        </div>
        <div className="order-1 min-w-0 lg:order-2">
          <div className="mb-4 flex items-center justify-between gap-3">
            <ListingControls />
          </div>
          <ProductGrid products={result.items} />
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
