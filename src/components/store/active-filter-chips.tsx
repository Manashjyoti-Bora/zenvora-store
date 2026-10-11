import Link from 'next/link';
import type { CategoryTile } from '@/lib/catalog/storefront';

interface ActiveFilterChipsProps {
  basePath: string;
  searchParams: Record<string, string | undefined>;
  categories: CategoryTile[];
  activeCategory?: string | null;
  categoryInPath?: boolean;
}

function toHref(
  path: string,
  searchParams: Record<string, string | undefined>,
  removedKeys: string[] = []
): string {
  const removed = new Set([...removedKeys, 'page']);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value && !removed.has(key)) params.set(key, value);
  }
  const query = params.toString();
  return `${path}${query ? `?${query}` : ''}`;
}

function formatRupees(value: string): string {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0
    ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(amount)
    : value;
}

/** Shareable, removable filter state. Search terms and sort order survive facet changes. */
export function ActiveFilterChips({
  basePath,
  searchParams,
  categories,
  activeCategory,
  categoryInPath = false,
}: ActiveFilterChipsProps) {
  const chips: Array<{ key: string; label: string; href: string }> = [];
  const category = activeCategory
    ? (categories.find((item) => item.slug === activeCategory)?.name ?? activeCategory)
    : null;

  if (category) {
    chips.push({
      key: 'category',
      label: `Category: ${category}`,
      href: toHref(categoryInPath ? '/shop' : basePath, searchParams, ['category']),
    });
  }

  const query = searchParams.q?.trim();
  if (query) {
    chips.push({
      key: 'q',
      label: `Search: “${query}”`,
      href: toHref(basePath, searchParams, ['q']),
    });
  }

  const min = searchParams.min;
  const max = searchParams.max;
  if (min || max) {
    const label =
      min && max
        ? `₹${formatRupees(min)}–₹${formatRupees(max)}`
        : min
          ? `From ₹${formatRupees(min)}`
          : `Up to ₹${formatRupees(max!)}`;
    chips.push({
      key: 'price',
      label: `Price: ${label}`,
      href: toHref(basePath, searchParams, ['min', 'max']),
    });
  }

  if (searchParams.stock === '1') {
    chips.push({
      key: 'stock',
      label: 'In stock only',
      href: toHref(basePath, searchParams, ['stock']),
    });
  }

  if (chips.length === 0) return null;

  const clearPath = categoryInPath ? '/shop' : basePath;
  const clearHref = toHref(clearPath, searchParams, ['category', 'min', 'max', 'stock']);

  return (
    <nav className="mb-4 flex flex-wrap items-center gap-2" aria-label="Active filters">
      <span className="mr-1 text-xs font-semibold text-ink-500">Applied:</span>
      {chips.map((chip) => (
        <Link
          key={chip.key}
          href={chip.href}
          aria-label={`Remove ${chip.label}`}
          className="inline-flex min-h-8 max-w-full items-center rounded-full border border-brand-700/20 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-800 transition-colors hover:border-brand-700/40 hover:bg-brand-100"
        >
          <span className="max-w-[14rem] truncate">{chip.label}</span>
          <span className="ml-1.5 text-brand-700" aria-hidden="true">
            ×
          </span>
        </Link>
      ))}
      <Link
        href={clearHref}
        className="ml-1 inline-flex min-h-8 items-center px-2 text-xs font-semibold text-ink-500 underline underline-offset-2 transition-colors hover:text-brand-800"
      >
        Clear filters
      </Link>
    </nav>
  );
}
