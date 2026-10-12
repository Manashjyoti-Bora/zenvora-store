import type { Metadata } from 'next';
import { env } from '@/lib/env';
import { getSettings } from '@/lib/settings';
import {
  listStorefrontProducts,
  listActiveCategories,
  parseSort,
  parsePriceBound,
} from '@/lib/catalog/storefront';
import {
  breadcrumbJsonLd,
  carryListingQuery,
  isFilteredListing,
  itemListJsonLd,
  listingDescription,
  listingSeo,
  listingTitle,
} from '@/lib/seo/listing';
import { ProductGrid } from '@/components/store/product-grid';
import { FilterSidebar } from '@/components/store/filter-sidebar';
import { ListingControls } from '@/components/store/listing-controls';
import { Pagination } from '@/components/ui/table';
import { jsonLdScript } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<ListingSearchParams>;
}): Promise<Metadata> {
  const settings = await getSettings();
  const sp = await searchParams;
  // Filtered combinations are crawled for discovery but never indexed as
  // their own landing pages (canonical + noindex); paginated pages keep
  // distinct titles so they never share metadata with page 1.
  const seo = listingSeo('/shop', sp);
  const baseDescription = `Browse the full ${settings.storeName} catalog. Transparent ₹ pricing, secure checkout and pan-India delivery.`;
  return {
    title: listingTitle('Shop all products', seo.filtered ? 1 : seo.page),
    description: listingDescription(baseDescription, seo.filtered ? 1 : seo.page),
    alternates: { canonical: seo.canonical },
    ...(seo.robots ? { robots: seo.robots } : {}),
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

  const filtered = isFilteredListing(params);
  const crumbs = [{ label: 'Home', href: '/' }, { label: 'Shop' }];
  const itemList = itemListJsonLd(
    env.APP_URL,
    result.items.map((p) => ({ name: p.name, slug: p.slug })),
    'Shop all products'
  );

  return (
    <div className="container-store py-6 sm:py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbJsonLd(env.APP_URL, crumbs)) }}
      />
      {itemList && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(itemList) }}
        />
      )}
      <header className="mb-6 rounded-2xl border border-ink-900/[0.06] bg-gradient-to-br from-sage-100/60 via-white to-cream-50 p-5 shadow-card sm:p-6">
        <p className="eyebrow">Catalogue</p>
        <h1 className="display mt-1.5">Shop all products</h1>
        <p className="mt-1.5 text-sm tabular-nums text-ink-400">
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
            categoryHref={(slug) => `/categories/${slug}${carryListingQuery(params)}`}
          />
        </div>
        <div className="order-1 min-w-0 lg:order-2">
          <div className="mb-4 flex items-center justify-between gap-3">
            <ListingControls />
          </div>
          <ProductGrid products={result.items} clearHref={filtered ? '/shop' : undefined} />
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
