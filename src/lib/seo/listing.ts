/**
 * Listing-page SEO helpers (shop / category / search).
 *
 * Pure functions with no database or framework imports so the canonical /
 * robots / structured-data rules are unit-testable and cannot drift between
 * `generateMetadata` and the page body.
 *
 * Indexing policy (one place, enforced by every listing route):
 *  - Clean page 1 (`/shop`, `/categories/:slug`) ............. indexable, self canonical.
 *  - Clean page N>1 (`?page=N`, no filters) ................... indexable, self canonical
 *    with `?page=N` (deep catalogue pages stay crawlable) and a distinct
 *    "– Page N" title so paginated pages never share metadata.
 *  - Any filtered view (`q`, `category`, `min`/`max`, `stock`, non-default
 *    `sort`) ................................................. `noindex, follow`
 *    with a canonical to the clean listing URL, so filter combinations can be
 *    crawled for discovery but never bloat the index with duplicates.
 *  - Legacy `/shop?category=:slug` ............................ `noindex, follow`
 *    with a canonical to `/categories/:slug` (the one true category URL).
 */

export interface ListingQuery {
  q?: string;
  category?: string;
  sort?: string;
  page?: string;
  min?: string;
  max?: string;
  stock?: string;
  [key: string]: string | undefined;
}

export interface ListingRobots {
  index: boolean;
  follow: boolean;
}

export interface ListingSeo {
  /** Path (relative canonical; resolved against metadataBase). */
  canonical: string;
  /** Undefined = inherit the default indexable robots. */
  robots: ListingRobots | undefined;
  page: number;
  filtered: boolean;
}

export const LISTING_DEFAULT_SORT = 'featured';

/** Query keys that are safe to carry when navigating between listings. */
const CARRY_KEYS = ['q', 'sort', 'min', 'max', 'stock'] as const;

/** 1-based page number; garbage input falls back to 1. */
export function parseListingPage(value: string | undefined): number {
  if (value == null || value === '') return 1;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

/**
 * True when the query string selects a subset/reordering of the listing that
 * must not be indexed as its own landing page. `page` alone is NOT a filter
 * (paginated catalogue pages stay indexable for deep crawling).
 */
export function isFilteredListing(sp: ListingQuery): boolean {
  if (sp.q != null && sp.q.trim() !== '') return true;
  if (sp.category != null && sp.category.trim() !== '') return true;
  if (sp.min != null && sp.min !== '') return true;
  if (sp.max != null && sp.max !== '') return true;
  if (sp.stock === '1') return true;
  const sort = (sp.sort ?? '').trim();
  if (sort !== '' && sort !== LISTING_DEFAULT_SORT) return true;
  return false;
}

/**
 * Canonical URL + robots decision for a listing page.
 *
 * @param cleanPath The filter-free path of the listing
 *   (`/shop` or `/categories/:slug`).
 */
export function listingSeo(cleanPath: string, sp: ListingQuery): ListingSeo {
  const page = parseListingPage(sp.page);
  const filtered = isFilteredListing(sp);

  if (filtered) {
    // Legacy shop filter URLs consolidate onto the canonical category page.
    const category = (sp.category ?? '').trim();
    if (cleanPath === '/shop' && category !== '') {
      return {
        canonical: `/categories/${category}`,
        robots: { index: false, follow: true },
        page,
        filtered,
      };
    }
    return { canonical: cleanPath, robots: { index: false, follow: true }, page, filtered };
  }

  if (page > 1) {
    return { canonical: `${cleanPath}?page=${page}`, robots: undefined, page, filtered };
  }
  return { canonical: cleanPath, robots: undefined, page, filtered };
}

/** Distinct <title> for paginated listings; page 1 keeps the base title. */
export function listingTitle(baseTitle: string, page: number): string {
  return page > 1 ? `${baseTitle} – Page ${page}` : baseTitle;
}

/** Distinct meta description for paginated listings. */
export function listingDescription(baseDescription: string, page: number): string {
  return page > 1 ? `${baseDescription} (Page ${page}.)` : baseDescription;
}

/**
 * Carry the user's listing context (query, sort, price band, stock toggle)
 * when navigating between listing surfaces — e.g. shop → category — without
 * carrying pagination (`page`) or the consumed `category` selector itself.
 * Returns "" or a "?…" suffix ready to append to a path.
 */
export function carryListingQuery(sp: ListingQuery, keys: readonly string[] = CARRY_KEYS): string {
  const params = new URLSearchParams();
  for (const key of keys) {
    const value = sp[key];
    if (value != null && value !== '') params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** Resolve a (possibly relative) image/file URL against the public origin. */
export function absoluteUrl(baseUrl: string, url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = baseUrl.replace(/\/$/, '');
  return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`;
}

export interface CrumbInput {
  label: string;
  href?: string;
}

/**
 * BreadcrumbList JSON-LD. The final (current-page) crumb omits `item` per
 * schema.org guidance. Callers must pass the SAME crumbs rendered visibly.
 */
export function breadcrumbJsonLd(baseUrl: string, crumbs: CrumbInput[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.label,
      ...(crumb.href ? { item: absoluteUrl(baseUrl, crumb.href) } : {}),
    })),
  };
}

export interface ItemListEntry {
  name: string;
  slug: string;
}

/**
 * ItemList JSON-LD for the products actually rendered on this listing page.
 * Returns null when there is nothing to list (never emit an empty ItemList).
 * Positions reflect on-page order; URLs are the canonical product URLs.
 */
export function itemListJsonLd(
  baseUrl: string,
  items: ItemListEntry[],
  name?: string
): Record<string, unknown> | null {
  if (items.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    ...(name ? { name } : {}),
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      url: `${baseUrl.replace(/\/$/, '')}/products/${item.slug}`,
    })),
  };
}
