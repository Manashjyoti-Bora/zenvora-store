import { ProductCard } from './product-card';
import { EmptyState } from '@/components/ui/feedback';
import { LinkButton } from '@/components/ui/button';
import type { ProductCardData } from '@/lib/catalog/storefront';
import { SearchIcon } from '@/components/ui/icons';

export function ProductGrid({
  products,
  clearHref,
}: {
  products: ProductCardData[];
  /**
   * When the listing was filtered/searched and came back empty, pass the
   * filter-free URL so the empty state offers a one-click "Clear filters"
   * recovery instead of only a generic browse link.
   */
  clearHref?: string;
}) {
  if (products.length === 0) {
    if (clearHref) {
      return (
        <EmptyState
          icon={<SearchIcon className="h-6 w-6" />}
          title="No products match these filters"
          description="Try removing some filters or search terms to see more of the catalog."
          action={
            <span className="flex flex-wrap items-center justify-center gap-2.5">
              <LinkButton href={clearHref}>Clear filters</LinkButton>
              <LinkButton href="/shop" variant="outline">
                Browse all products
              </LinkButton>
            </span>
          }
        />
      );
    }
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
