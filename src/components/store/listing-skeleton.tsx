/**
 * Streaming skeletons for listing/product routes (used by `loading.tsx`).
 * Pure static markup: no data, no layout shift once content streams in
 * (same grid + aspect ratios as the real surfaces).
 */
export function ListingSkeleton({ cards = 8 }: { cards?: number }) {
  return (
    <div
      className="container-store py-6 sm:py-8"
      aria-busy="true"
      aria-label="Loading products"
      role="status"
    >
      <div className="skeleton mb-6 h-28 w-full !rounded-2xl" aria-hidden="true" />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr]">
        <div className="order-2 hidden lg:order-1 lg:block" aria-hidden="true">
          <div className="skeleton h-72 w-full !rounded-xl" />
        </div>
        <div className="order-1 min-w-0 lg:order-2" aria-hidden="true">
          <div className="skeleton mb-4 h-9 w-56" />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: cards }, (_, i) => (
              <div
                key={i}
                className="overflow-hidden rounded-xl border border-ink-900/[0.06] bg-white"
              >
                <div className="skeleton aspect-[4/5] !rounded-none" />
                <div className="space-y-2 p-3 sm:p-4">
                  <div className="skeleton h-3 w-2/3" />
                  <div className="skeleton h-4 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <span className="sr-only">Loading products…</span>
    </div>
  );
}

export function ProductSkeleton() {
  return (
    <div
      className="container-store pt-6 sm:pt-8"
      aria-busy="true"
      aria-label="Loading product"
      role="status"
    >
      <div className="skeleton mb-4 h-4 w-64" aria-hidden="true" />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2" aria-hidden="true">
        <div className="skeleton aspect-square !rounded-xl" />
        <div className="space-y-4">
          <div className="skeleton h-8 w-3/4" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-5/6" />
          <div className="skeleton h-12 w-48 !rounded-lg" />
          <div className="skeleton h-24 w-full !rounded-xl" />
        </div>
      </div>
      <span className="sr-only">Loading product…</span>
    </div>
  );
}
