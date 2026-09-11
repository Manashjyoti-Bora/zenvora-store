import Link from 'next/link';
import Image from 'next/image';
import { formatINR, formatDiscountPercent } from '@/lib/money';
import { AddToCartButton } from './add-to-cart-button';
import type { ProductCardData } from '@/lib/catalog/storefront';

function BagGlyph({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.5 8h13l-1 11.5a1.5 1.5 0 0 1-1.5 1.4H8a1.5 1.5 0 0 1-1.5-1.4L5.5 8Z" />
      <path strokeLinecap="round" d="M9 10V6.8a3 3 0 0 1 6 0V10" />
    </svg>
  );
}

/**
 * Storefront product card. All data is real (prices from the pricing engine,
 * discounts only when a compare-at price exists, stock states from inventory).
 * Portrait imagery + layered hover/tap states; no fabricated social proof.
 */
export function ProductCard({ product }: { product: ProductCardData }) {
  const soldOut = product.stock === 0;
  const lowStock =
    !soldOut &&
    product.stock > 0 &&
    product.lowStockThreshold > 0 &&
    product.stock <= product.lowStockThreshold;
  const discount = formatDiscountPercent(product.pricePaise, product.compareAtPricePaise);
  const onSale = product.compareAtPricePaise != null && product.compareAtPricePaise > product.pricePaise;

  return (
    <article className="card card-hover group relative flex flex-col overflow-hidden focus-within:ring-2 focus-within:ring-brand-500 focus-within:ring-offset-2 focus-within:ring-offset-cream-50">
      <div className="relative aspect-[4/5] overflow-hidden bg-cream-100">
        {product.imageUrls[0] ? (
          <Link href={`/products/${product.slug}`} tabIndex={-1} aria-hidden="true">
            <Image
              src={product.imageUrls[0]}
              alt={product.imageAlt || product.name}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.05]"
              loading="lazy"
            />
          </Link>
        ) : (
          <Link
            href={`/products/${product.slug}`}
            tabIndex={-1}
            aria-hidden="true"
            className="flex h-full items-center justify-center text-cream-300"
          >
            <BagGlyph />
          </Link>
        )}

        {soldOut && (
          <div className="absolute inset-0 bg-ink-950/45" aria-hidden="true">
            <span className="absolute inset-x-3 top-1/2 -translate-y-1/2 rounded-md bg-white/95 py-1.5 text-center text-xs font-bold uppercase tracking-eyebrow text-ink-900">
              Sold out
            </span>
          </div>
        )}

        <div className="absolute left-2.5 top-2.5 flex flex-col items-start gap-1.5">
          {discount != null && !soldOut && (
            <span className="rounded-full bg-accent-600 px-2 py-0.5 text-[11px] font-bold leading-4 text-white shadow-soft">
              −{discount}%
            </span>
          )}
          {lowStock && (
            <span className="rounded-full bg-ink-950/85 px-2 py-0.5 text-[11px] font-semibold leading-4 text-brass-200 backdrop-blur-sm">
              Only {product.stock} left
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-4">
        {product.categoryName && (
          <p className="eyebrow text-gray-500">{product.categoryName}</p>
        )}
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-ink-900">
          <Link
            href={`/products/${product.slug}`}
            className="transition-colors after:absolute after:inset-0 after:content-[''] hover:text-brand-700"
          >
            {product.name}
          </Link>
        </h3>
        <div className="mt-auto flex items-end justify-between gap-2 pt-2.5">
          <div className="min-w-0">
            <p className="text-[17px] font-bold leading-6 tabular-nums text-ink-900">
              {formatINR(product.pricePaise)}
            </p>
            {onSale && (
              <p className="mt-0.5 text-xs tabular-nums text-gray-500 line-through">
                {formatINR(product.compareAtPricePaise!)}
              </p>
            )}
          </div>
          <div className="relative z-10">
            <AddToCartButton productId={product.id} disabled={soldOut} compact />
          </div>
        </div>
      </div>
    </article>
  );
}
