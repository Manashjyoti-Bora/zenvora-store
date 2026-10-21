import { LoadingRegion, ProductGridSkeleton, Skeleton } from '@/components/ui/skeleton';

export default function ProductLoading() {
  return (
    <LoadingRegion label="Loading product" className="container-store pb-28 pt-6 sm:pt-8 lg:pb-8">
      {/* Breadcrumb */}
      <Skeleton className="h-3 w-56 max-w-full" />

      <div className="mt-5 grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Gallery: main image + thumbnail rail */}
        <div>
          <Skeleton className="aspect-square w-full rounded-xl" />
          <div className="mt-3 flex gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-16 w-16 rounded-lg sm:h-20 sm:w-20" />
            ))}
          </div>
        </div>

        {/* Buy box: title, price, options, CTA */}
        <div className="space-y-4">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-8 w-4/5" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <div className="flex gap-2 pt-2">
            <Skeleton className="h-10 w-24 rounded-full" />
            <Skeleton className="h-10 w-24 rounded-full" />
          </div>
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      </div>

      {/* Related products */}
      <div className="mt-16">
        <Skeleton className="h-6 w-48" />
        <div className="mt-6">
          <ProductGridSkeleton count={4} />
        </div>
      </div>
    </LoadingRegion>
  );
}
