import Link from 'next/link';
import Image from 'next/image';
import { formatINR, formatDiscountPercent } from '@/lib/money';
import { Badge } from '@/components/ui/badge';
import { AddToCartButton } from './add-to-cart-button';
import type { ProductCardData } from '@/lib/catalog/storefront';

export function ProductCard({ product }: { product: ProductCardData }) {
  const soldOut = product.stock === 0;
  const lowStock =
    !soldOut && product.stock > 0 && product.lowStockThreshold > 0 && product.stock <= product.lowStockThreshold;
  const discount = formatDiscountPercent(product.pricePaise, product.compareAtPricePaise);

  return (
    <article className="card group flex flex-col overflow-hidden transition-shadow hover:shadow-md">
      <div className="relative aspect-square bg-gray-100">
        {product.imageUrls[0] ? (
          <Link href={`/products/${product.slug}`} tabIndex={-1} aria-hidden="true">
            <Image
              src={product.imageUrls[0]}
              alt={product.imageAlt || product.name}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              loading="lazy"
            />
          </Link>
        ) : (
          <Link
            href={`/products/${product.slug}`}
            tabIndex={-1}
            aria-hidden="true"
            className="flex h-full items-center justify-center text-4xl text-gray-300"
          >
            🛍️
          </Link>
        )}
        <div className="absolute left-2 top-2 flex flex-col gap-1">
          {discount != null && <Badge tone="red">-{discount}%</Badge>}
          {soldOut && <Badge tone="gray">Sold out</Badge>}
          {lowStock && <Badge tone="amber">Only {product.stock} left</Badge>}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3.5">
        {product.categoryName && (
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
            {product.categoryName}
          </p>
        )}
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-gray-900">
          <Link href={`/products/${product.slug}`} className="hover:text-brand-700">
            {product.name}
          </Link>
        </h3>
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div>
            <p className="text-base font-bold tabular-nums text-gray-900">
              {formatINR(product.pricePaise)}
            </p>
            {product.compareAtPricePaise && product.compareAtPricePaise > product.pricePaise && (
              <p className="text-xs tabular-nums text-gray-400 line-through">
                {formatINR(product.compareAtPricePaise)}
              </p>
            )}
          </div>
          <AddToCartButton productId={product.id} disabled={soldOut} compact />
        </div>
      </div>
    </article>
  );
}
