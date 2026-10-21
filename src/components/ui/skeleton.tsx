import { cn } from '@/lib/utils';

/**
 * Loading skeletons.
 *
 * The App Router renders `loading.tsx` as the Suspense fallback while a route
 * segment's data is still being fetched. These placeholders mirror the real
 * layout (same grid, same aspect ratios, same box sizes) so the page does not
 * jump when content arrives, and they announce themselves to assistive tech
 * rather than showing a silent blank screen.
 *
 * They reuse the existing `.skeleton` shimmer from globals.css so loading
 * states stay visually consistent with the rest of the design system.
 */

/** A single shimmering placeholder box. Purely decorative — never announced. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden="true" />;
}

/**
 * Wraps a loading UI region so screen readers are told something is loading.
 * The skeletons inside are aria-hidden, so this wrapper carries the message.
 */
export function LoadingRegion({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Mirrors the shape of `ProductCard` (aspect-[4/5] image + text block). */
export function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-ink-900/5 bg-white">
      <Skeleton className="aspect-[4/5] w-full rounded-none" />
      <div className="flex flex-col gap-1.5 p-3 sm:p-4">
        <Skeleton className="h-2.5 w-1/3" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="mt-1.5 h-5 w-1/2" />
      </div>
    </div>
  );
}

/** Mirrors the `ProductGrid` column counts at every breakpoint. */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** The filter rail shown beside the grid on /shop, /search and /categories. */
export function FilterRailSkeleton() {
  return (
    <div className="hidden lg:block">
      <div className="space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="mt-6 h-4 w-28" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="mt-6 h-4 w-20" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}
