import {
  FilterRailSkeleton,
  LoadingRegion,
  ProductGridSkeleton,
  Skeleton,
} from '@/components/ui/skeleton';

export default function SearchLoading() {
  return (
    <LoadingRegion label="Loading search results" className="container-store py-6 sm:py-8">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-9 w-80 max-w-full" />
      <Skeleton className="mt-3 h-4 w-36" />

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr]">
        <FilterRailSkeleton />
        <ProductGridSkeleton />
      </div>
    </LoadingRegion>
  );
}
