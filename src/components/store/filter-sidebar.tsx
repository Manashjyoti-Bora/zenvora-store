import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { CategoryTile } from '@/lib/catalog/storefront';

const PRICE_BANDS = [
  { label: 'Under ₹250', min: null, max: 250 },
  { label: '₹250 – ₹500', min: 250, max: 500 },
  { label: '₹500 – ₹1,000', min: 500, max: 1000 },
  { label: '₹1,000 – ₹2,500', min: 1000, max: 2500 },
  { label: 'Above ₹2,500', min: 2500, max: null },
];

interface FilterSidebarProps {
  categories: CategoryTile[];
  basePath: string;
  activeCategory: string | null;
  searchParams: Record<string, string | undefined>;
  presentation?: 'mobile' | 'desktop';
  categoryBasePath?: string;
}

/**
 * Server-rendered filters. Links preserve the current search/sort state, and
 * every change drops `page` so a filter cannot strand customers on an empty
 * later page. The mobile version uses native disclosure rather than a JS
 * drawer, keeping it keyboard/touch accessible with no extra client bundle.
 */
export function FilterSidebar({
  categories,
  basePath,
  activeCategory,
  searchParams,
  presentation = 'desktop',
  categoryBasePath,
}: FilterSidebarProps) {
  const preserve = (over: Record<string, string | null>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value && key !== 'page' && !(key in over)) params.set(key, value);
    }
    for (const [key, value] of Object.entries(over)) {
      if (value != null) params.set(key, value);
    }
    const query = params.toString();
    return `${basePath}${query ? `?${query}` : ''}`;
  };

  const categoryHref = (slug: string | null) => {
    if (!categoryBasePath) return preserve({ category: slug });
    const path = slug ? `${categoryBasePath}/${slug}` : '/shop';
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value && key !== 'page' && key !== 'category') params.set(key, value);
    }
    const query = params.toString();
    return `${path}${query ? `?${query}` : ''}`;
  };

  const currentMin = searchParams.min;
  const currentMax = searchParams.max;
  const activeBand = PRICE_BANDS.findIndex(
    (band) =>
      String(band.min ?? '') === (currentMin ?? '') && String(band.max ?? '') === (currentMax ?? '')
  );
  const activeFilterCount =
    Number(Boolean(activeCategory)) +
    Number(Boolean(currentMin || currentMax)) +
    Number(searchParams.stock === '1');

  const filters = (
    <>
      <nav aria-label="Categories">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-eyebrow text-ink-400">
          Categories
        </h2>
        <ul className="space-y-1">
          <li>
            <Link
              href={categoryHref(null)}
              aria-current={!activeCategory ? 'page' : undefined}
              className={cn(
                'flex min-h-10 items-center rounded-lg px-3 py-1.5 text-sm transition-colors',
                !activeCategory
                  ? 'bg-brand-50 font-semibold text-brand-800 ring-1 ring-brand-500/20'
                  : 'text-ink-600 hover:bg-cream-50'
              )}
            >
              All products
            </Link>
          </li>
          {categories.map((category) => (
            <li key={category.id}>
              <Link
                href={categoryHref(category.slug)}
                aria-current={activeCategory === category.slug ? 'page' : undefined}
                className={cn(
                  'flex min-h-10 items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors',
                  activeCategory === category.slug
                    ? 'bg-brand-50 font-semibold text-brand-800 ring-1 ring-brand-500/20'
                    : 'text-ink-600 hover:bg-cream-50'
                )}
              >
                <span className="truncate">{category.name}</span>
                <span className="shrink-0 rounded-full bg-cream-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-ink-500">
                  {category.productCount}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <nav aria-label="Price filters" className="border-t border-ink-900/10 pt-4">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-eyebrow text-ink-400">
          Price range
        </h2>
        <ul className="space-y-1">
          {PRICE_BANDS.map((band, index) => (
            <li key={band.label}>
              <Link
                href={
                  activeBand === index
                    ? preserve({ min: null, max: null })
                    : preserve({
                        min: band.min != null ? String(band.min) : null,
                        max: band.max != null ? String(band.max) : null,
                      })
                }
                aria-current={activeBand === index ? 'true' : undefined}
                className={cn(
                  'flex min-h-10 items-center rounded-lg px-3 py-1.5 text-sm transition-colors',
                  activeBand === index
                    ? 'bg-brand-50 font-semibold text-brand-800 ring-1 ring-brand-500/20'
                    : 'text-ink-600 hover:bg-cream-50'
                )}
              >
                {band.label}
              </Link>
            </li>
          ))}
          {(currentMin || currentMax) && activeBand === -1 && (
            <li>
              <Link
                href={preserve({ min: null, max: null })}
                className="flex min-h-10 items-center px-3 py-1.5 text-xs font-medium text-brand-700 underline underline-offset-2"
              >
                Clear price filter
              </Link>
            </li>
          )}
        </ul>
      </nav>
    </>
  );

  if (presentation === 'mobile') {
    return (
      <details className="card group overflow-hidden lg:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2">
            <span>Browse filters</span>
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-bold tabular-nums text-brand-800">
                {activeFilterCount} active
              </span>
            )}
          </span>
          <svg
            className="h-4 w-4 shrink-0 text-ink-500 transition-transform duration-200 group-open:rotate-180"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <div className="space-y-6 border-t border-ink-900/10 p-4">{filters}</div>
      </details>
    );
  }

  return (
    <aside
      className="card sticky top-20 hidden space-y-6 p-4 lg:block"
      aria-label="Product filters"
    >
      {filters}
    </aside>
  );
}
