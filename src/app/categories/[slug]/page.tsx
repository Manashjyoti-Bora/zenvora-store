import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { env } from '@/lib/env';
import {
  getCategoryBySlug,
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
import { Breadcrumbs } from '@/components/store/breadcrumbs';
import { jsonLdScript } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

export async function generateMetadata({
  params,
  searchParams,
}: Ctx & { searchParams: Promise<Record<string, string | undefined>> }): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  // Throw (not fallback metadata) so the response status is a real 404.
  if (!category) notFound();
  // Same listing policy as /shop: filtered combinations consolidate onto the
  // clean category URL (canonical + noindex); paginated pages keep distinct
  // titles so they never share metadata with page 1.
  const seo = listingSeo(`/categories/${category.slug}`, await searchParams);
  const baseTitle = category.seoTitle || category.name;
  const baseDescription =
    category.seoDescription ||
    category.description ||
    `Shop ${category.name} online. Quality products at transparent prices.`;
  const effectivePage = seo.filtered ? 1 : seo.page;
  return {
    title: listingTitle(baseTitle, effectivePage),
    description: listingDescription(baseDescription, effectivePage),
    alternates: { canonical: seo.canonical },
    ...(seo.robots ? { robots: seo.robots } : {}),
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: Ctx & { searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const category = await getCategoryBySlug(slug);
  if (!category) notFound();

  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const [result, categories] = await Promise.all([
    listStorefrontProducts({
      categorySlug: category.slug,
      q: sp.q,
      sort: parseSort(sp.sort),
      page,
      minPricePaise: parsePriceBound(sp.min),
      maxPricePaise: parsePriceBound(sp.max),
      inStockOnly: sp.stock === '1',
    }),
    listActiveCategories(),
  ]);

  const cleanPath = `/categories/${category.slug}`;
  const filtered = isFilteredListing(sp);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: category.name,
    description: category.description ?? undefined,
    url: `${env.APP_URL}${cleanPath}`,
  };

  // Visible breadcrumbs and BreadcrumbList JSON-LD share one source of truth.
  const crumbs = [
    { label: 'Home', href: '/' },
    { label: 'Shop', href: '/shop' },
    ...(category.parent
      ? [{ label: category.parent.name, href: `/categories/${category.parent.slug}` }]
      : []),
    { label: category.name },
  ];

  const itemList = itemListJsonLd(
    env.APP_URL,
    result.items.map((p) => ({ name: p.name, slug: p.slug })),
    category.name
  );

  return (
    <div className="container-store py-6 sm:py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />
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
      <Breadcrumbs items={crumbs} />
      <header className="mb-6 rounded-2xl border border-ink-900/10 bg-gradient-to-br from-cream-100/80 via-white to-cream-50 p-5 shadow-hair sm:p-6">
        <p className="eyebrow">{category.parent ? 'Subcategory' : 'Category'}</p>
        <h1 className="display mt-1.5">{category.name}</h1>
        {category.description && (
          <p className="mt-1 max-w-2xl text-sm text-ink-500">{category.description}</p>
        )}
        <p className="mt-1 text-sm tabular-nums text-ink-400">
          {result.total} product{result.total === 1 ? '' : 's'}
        </p>
        {category.children && category.children.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-900/10 pt-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">
              Subcategories:
            </span>
            {category.children.map((sub) => (
              <Link
                key={sub.id}
                href={`/categories/${sub.slug}`}
                className="rounded-full border border-ink-900/15 bg-white px-3 py-1 text-xs font-medium text-ink-700 hover:border-brand-500 hover:text-brand-700"
              >
                {sub.name}
              </Link>
            ))}
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr]">
        <div className="order-2 lg:order-1">
          {/* Filters stay in-category (basePath is this category page) while
              category links navigate the canonical /categories/* URLs. */}
          <FilterSidebar
            categories={categories}
            basePath={cleanPath}
            activeCategory={category.slug}
            searchParams={sp}
            allHref={`/shop${carryListingQuery(sp)}`}
            categoryHref={(s) => `/categories/${s}${carryListingQuery(sp)}`}
          />
        </div>
        <div className="order-1 min-w-0 lg:order-2">
          <div className="mb-4">
            <ListingControls />
          </div>
          <ProductGrid products={result.items} clearHref={filtered ? cleanPath : undefined} />
          <Pagination
            page={result.page}
            totalPages={result.totalPages}
            basePath={cleanPath}
            searchParams={{ sort: sp.sort, min: sp.min, max: sp.max, stock: sp.stock }}
          />
          <p className="mt-6 text-xs text-ink-400">
            Looking for something else?{' '}
            <Link href="/shop" className="link-primary">
              Browse all products
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
