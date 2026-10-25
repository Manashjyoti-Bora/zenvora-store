import { cn } from '@/lib/utils';

/**
 * Loading placeholder.
 *
 * Route-level `loading.tsx` files that use these MUST NOT be added to routes
 * that can call `notFound()` (e.g. `/products/[slug]`, `/categories/[slug]`):
 * a loading boundary makes Next.js flush the shell with HTTP 200 before the
 * page resolves, turning a real 404 into a soft 404 (verified locally,
 * e2e `storefront.test.ts` guards it). Use them on listing routes only.
 * Shimmer is a transform-only animation on a pseudo
 * layer (no layout, blur or shadow animation) and is disabled under
 * prefers-reduced-motion by the global rule in globals.css.
 */
export function Skeleton({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn('skeleton rounded-lg', className)} {...rest} />;
}

/** Grid of product-card shaped placeholders matching ProductGrid's layout. */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4" role="status" aria-live="polite">
      <span className="sr-only">Loading products…</span>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-xl border border-cream-200 bg-white">
          <Skeleton className="aspect-[4/5] w-full rounded-none" />
          <div className="space-y-2 p-3">
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PageHeaderSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-56 sm:w-72" />
      <Skeleton className="h-3.5 w-40" />
    </div>
  );
}
