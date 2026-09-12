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

/**
 * Server-rendered filter sidebar. All filters are plain links (no JS
 * required), preserving the current query where sensible.
 */
export function FilterSidebar({
  categories,
  basePath,
  activeCategory,
  searchParams,
}: {
  categories: CategoryTile[];
  basePath: string;
  activeCategory: string | null;
  searchParams: Record<string, string | undefined>;
}) {
  const preserve = (over: Record<string, string | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v && !(k in over)) p.set(k, v);
    }
    for (const [k, v] of Object.entries(over)) {
      if (v != null) p.set(k, v);
    }
    const qs = p.toString();
    return `${basePath}${qs ? `?${qs}` : ''}`;
  };

  const currentMin = searchParams.min;
  const currentMax = searchParams.max;
  const activeBand = PRICE_BANDS.findIndex(
    (b) => String(b.min ?? '') === (currentMin ?? '') && String(b.max ?? '') === (currentMax ?? '')
  );

  return (
    <aside className="space-y-6 lg:sticky lg:top-20" aria-label="Product filters">
      <nav aria-label="Categories">
        <h2 className="mb-2 text-sm font-semibold text-ink-900">Categories</h2>
        <ul className="space-y-1">
          <li>
            <Link
              href={preserve({ category: null })}
              className={cn(
                'block rounded-lg px-3 py-1.5 text-sm',
                !activeCategory
                  ? 'bg-brand-50 font-semibold text-brand-800'
                  : 'text-ink-500 hover:bg-cream-50'
              )}
            >
              All products
            </Link>
          </li>
          {categories.map((c) => (
            <li key={c.id}>
              <Link
                href={preserve({ category: c.slug })}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm',
                  activeCategory === c.slug
                    ? 'bg-brand-50 font-semibold text-brand-800'
                    : 'text-ink-500 hover:bg-cream-50'
                )}
              >
                <span className="truncate">{c.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-ink-400">
                  {c.productCount}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <nav aria-label="Price filters">
        <h2 className="mb-2 text-sm font-semibold text-ink-900">Price</h2>
        <ul className="space-y-1">
          {PRICE_BANDS.map((b, i) => (
            <li key={b.label}>
              <Link
                href={preserve({
                  min: b.min != null ? String(b.min) : null,
                  max: b.max != null ? String(b.max) : null,
                })}
                className={cn(
                  'block rounded-lg px-3 py-1.5 text-sm',
                  activeBand === i
                    ? 'bg-brand-50 font-semibold text-brand-800'
                    : 'text-ink-500 hover:bg-cream-50'
                )}
              >
                {b.label}
              </Link>
            </li>
          ))}
          {(currentMin || currentMax) && (
            <li>
              <Link
                href={preserve({ min: null, max: null })}
                className="block px-3 py-1.5 text-xs font-medium text-brand-700 underline"
              >
                Clear price filter
              </Link>
            </li>
          )}
        </ul>
      </nav>
    </aside>
  );
}
