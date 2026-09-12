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
import { ProductGrid } from '@/components/store/product-grid';
import { FilterSidebar } from '@/components/store/filter-sidebar';
import { ListingControls } from '@/components/store/listing-controls';
import { Pagination } from '@/components/ui/table';
import { Breadcrumbs } from '@/components/store/breadcrumbs';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Ctx): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  // Throw (not fallback metadata) so the response status is a real 404.
  if (!category) notFound();
  return {
    title: category.seoTitle || category.name,
    description:
      category.seoDescription ||
      category.description ||
      `Shop ${category.name} online. Quality products at transparent prices.`,
    alternates: { canonical: `/categories/${category.slug}` },
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

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: category.name,
    description: category.description ?? undefined,
    url: `${env.APP_URL}/categories/${category.slug}`,
  };

  return (
    <div className="container-store py-6 sm:py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Breadcrumbs
        items={[
          { label: 'Home', href: '/' },
          { label: 'Shop', href: '/shop' },
          { label: category.name },
        ]}
      />
      <header className="mb-6">
        <p className="eyebrow">Category</p>
        <h1 className="display mt-1.5">{category.name}</h1>
        {category.description && (
          <p className="mt-1 max-w-2xl text-sm text-ink-400">{category.description}</p>
        )}
        <p className="mt-1 text-sm tabular-nums text-ink-400">
          {result.total} product{result.total === 1 ? '' : 's'}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr]">
        <div className="order-2 lg:order-1">
          <FilterSidebar
            categories={categories}
            basePath="/shop"
            activeCategory={category.slug}
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
            basePath={`/categories/${category.slug}`}
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
