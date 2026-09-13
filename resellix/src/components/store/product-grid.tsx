import { ProductCard } from './product-card';
import { EmptyState } from '@/components/ui/feedback';
import { LinkButton } from '@/components/ui/button';
import type { ProductCardData } from '@/lib/catalog/storefront';
import { SearchIcon } from '@/components/ui/icons';

export function ProductGrid({ products }: { products: ProductCardData[] }) {
  if (products.length === 0) {
    return (
      <EmptyState
        icon={<SearchIcon className="h-6 w-6" />}
        title="No products found"
        description="Try adjusting your filters or search terms, or browse the full catalog."
        action={<LinkButton href="/shop">Browse all products</LinkButton>}
      />
    );
  }
  return (
    <div className="stagger grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}
