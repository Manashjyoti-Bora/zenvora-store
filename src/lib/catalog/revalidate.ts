import { revalidatePath } from 'next/cache';

/**
 * Catalog cache invalidation.
 *
 * Every storefront route currently opts into `force-dynamic`, so nothing is
 * cached today and product changes are already visible immediately. This helper
 * exists so that invalidation is *explicit and in place* — if any route segment
 * is later switched to a cached/ISR mode (or a route handler starts using
 * `unstable_cache`), the catalog cannot silently go stale after a publish,
 * price change, archive, mapping or supplier sync.
 *
 * It is deliberately:
 *   - dependency-injectable (`revalidate`) so the invalidation paths are unit
 *     testable without a running Next.js request context;
 *   - failure-tolerant: losing a cache invalidation must never fail the
 *     mutation that triggered it (the write already succeeded).
 */

export type RevalidateFn = (path: string, type?: 'page' | 'layout') => void;

export interface CatalogRevalidationTargets {
  /** Product slugs whose pages changed. */
  productSlugs?: string[];
  /** Category slugs whose listing changed. */
  categorySlugs?: string[];
  /** Home/landing/sitemap always refresh on any catalog change. */
  includeLanding?: boolean;
}

const LANDING_PATHS = ['/', '/shop', '/search', '/sitemap.xml'];

/** Paths that must be invalidated for a given catalog change. */
export function catalogPathsFor(targets: CatalogRevalidationTargets): string[] {
  const paths = new Set<string>();
  if (targets.includeLanding !== false) {
    LANDING_PATHS.forEach((p) => paths.add(p));
  }
  for (const slug of targets.productSlugs ?? []) {
    if (slug) paths.add(`/products/${slug}`);
  }
  for (const slug of targets.categorySlugs ?? []) {
    if (slug) paths.add(`/categories/${slug}`);
  }
  return [...paths];
}

/**
 * Invalidate the storefront surfaces touched by a catalog change.
 * Never throws.
 */
export function revalidateCatalog(
  targets: CatalogRevalidationTargets = {},
  revalidate: RevalidateFn = revalidatePath
): string[] {
  const paths = catalogPathsFor(targets);
  const applied: string[] = [];
  for (const path of paths) {
    try {
      revalidate(path, 'page');
      applied.push(path);
    } catch {
      // Outside a request scope (CLI/scripts/background jobs) or a transient
      // cache error: the catalog data is already correct, so this is not fatal.
    }
  }
  return applied;
}
