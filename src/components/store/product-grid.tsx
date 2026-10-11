import { ProductCard } from './product-card';
import { EmptyState } from '@/components/ui/feedback';
import { LinkButton } from '@/components/ui/button';
import type { ProductCardData } from '@/lib/catalog/storefront';
import { BoxIcon, SearchIcon } from '@/components/ui/icons';
import type { ListingEmptyState } from '@/lib/catalog/listing-state';

export function ProductGrid({
  products,
  emptyState,
}: {
  products: ProductCardData[];
  emptyState?: ListingEmptyState | null;
}) {
  if (products.length === 0) {
    const state = emptyState ?? {
      kind: 'no-results' as const,
      title: 'No products found',
      description: 'Try adjusting your filters or search terms, or browse the full catalogue.',
      actionHref: '/shop',
      actionLabel: 'Browse all products',
    };
    return (
      <EmptyState
        icon={
          state.kind === 'catalog-empty' ? (
            <BoxIcon className="h-6 w-6" />
          ) : (
            <SearchIcon className="h-6 w-6" />
          )
        }
        title={state.title}
        description={state.description}
        action={
          <LinkButton
            href={state.actionHref}
            variant={state.kind === 'catalog-empty' ? 'outline' : 'primary'}
          >
            {state.actionLabel}
          </LinkButton>
        }
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
