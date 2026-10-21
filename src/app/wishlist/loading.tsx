import { LoadingRegion, ProductGridSkeleton, Skeleton } from '@/components/ui/skeleton';

export default function WishlistLoading() {
  return (
    <LoadingRegion label="Loading your wishlist" className="container-store py-6 sm:py-8">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-9 w-56 max-w-full" />
      <Skeleton className="mt-3 h-4 w-40" />
      <div className="mt-8">
        <ProductGridSkeleton count={4} />
      </div>
    </LoadingRegion>
  );
}
