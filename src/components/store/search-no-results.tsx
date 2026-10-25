import Link from 'next/link';
import { findSearchAlternatives, tokenizeSearchQuery } from '@/lib/catalog/search';
import { formatINR } from '@/lib/money';
import { EmptyState } from '@/components/ui/feedback';
import { LinkButton } from '@/components/ui/button';
import { SearchIcon } from '@/components/ui/icons';

/**
 * Server component for an empty /search result. Every suggestion comes from
 * the live catalogue (any-word matches, related categories, or what the store
 * currently features) — nothing is invented.
 */
export async function SearchNoResults({
  query,
  hasFilters,
  clearFiltersHref,
}: {
  query: string;
  hasFilters: boolean;
  clearFiltersHref: string;
}) {
  const alt = await findSearchAlternatives(query, { limit: 8 });
  const tokens = tokenizeSearchQuery(query);
  const narrower = alt.matchedTokens.filter((t) => t !== query.toLowerCase());

  return (
    <div className="space-y-8">
      <EmptyState
        icon={<SearchIcon className="h-6 w-6" />}
        title={`No results for “${query}”`}
        description={
          hasFilters
            ? 'Nothing matches this search with the current filters. Try clearing them, or use one of the suggestions below.'
            : tokens.length > 1
              ? 'Nothing matches all of those words together. Try fewer or more general words, or pick a suggestion below.'
              : 'Check the spelling, try a more general word, or browse a related category below.'
        }
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            {hasFilters && (
              <LinkButton href={clearFiltersHref} variant="secondary">
                Clear filters
              </LinkButton>
            )}
            <LinkButton href="/shop" variant={hasFilters ? 'outline' : 'primary'}>
              Browse all products
            </LinkButton>
          </div>
        }
      />

      {narrower.length > 0 && (
        <section aria-labelledby="try-words">
          <h2 id="try-words" className="text-sm font-semibold text-ink-900">
            Try searching for one word
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {narrower.map((t) => (
              <li key={t}>
                <Link
                  href={`/search?q=${encodeURIComponent(t)}`}
                  className="pill-tab border border-ink-900/10 bg-white text-ink-700 hover:border-brand-300 hover:text-brand-700"
                >
                  {t}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {alt.categories.length > 0 && (
        <section aria-labelledby="related-cats">
          <h2 id="related-cats" className="text-sm font-semibold text-ink-900">
            Related categories
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {alt.categories.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/categories/${c.slug}`}
                  className="pill-tab border border-ink-900/10 bg-sage-100 text-ink-800 hover:border-brand-300"
                >
                  {c.name}
                  <span className="tabular-nums text-ink-500">({c.productCount})</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(alt.partialMatches.length > 0 || alt.featured.length > 0) && (
        <section aria-labelledby="alt-products">
          <h2 id="alt-products" className="text-sm font-semibold text-ink-900">
            {alt.partialMatches.length > 0 ? 'Close matches' : 'Currently in the store'}
          </h2>
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(alt.partialMatches.length > 0 ? alt.partialMatches : alt.featured).map((p) => (
              <li key={p.id}>
                <Link
                  href={`/products/${p.slug}`}
                  className="card motion-lift flex items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink-900">{p.name}</span>
                    <span className="block truncate text-xs text-ink-400">
                      {[p.brand, p.categoryName].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums font-semibold text-ink-900">
                    {formatINR(p.pricePaise)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
