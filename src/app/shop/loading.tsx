import { PageHeaderSkeleton, ProductGridSkeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="container-store py-6 sm:py-8">
      <PageHeaderSkeleton />
      <div className="mt-6">
        <ProductGridSkeleton />
      </div>
    </div>
  );
}
