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
              className="object-cover transition-transform duration-500 ease-zenvora group-focus-within:scale-[1.05] [@media(hover:hover)]:group-hover:scale-[1.05]"
              loading="lazy"
            />
            {/* Signature crossfade: the product's real second image (when the
                catalog has one) breathes in on hover/keyboard-focus. Gated to
                (hover:hover) so touch never sticks; no second image = no layer,
                no cost. Decorative duplicate ⇒ empty alt. */}
            {product.imageUrls[1] && (
              <Image
                src={product.imageUrls[1]}
                alt=""
                fill
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                className="object-cover opacity-0 transition-[opacity,transform] duration-500 ease-zenvora group-focus-within:scale-[1.05] group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:scale-[1.05] [@media(hover:hover)]:group-hover:opacity-100"
                loading="lazy"
              />
            )}
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

        <div className="absolute left-2 top-2 flex flex-col items-start gap-1 sm:left-2.5 sm:top-2.5 sm:gap-1.5">
          {discount != null && !soldOut && (
            <span className="rounded-full bg-accent-600 px-2 py-0.5 text-[10px] font-bold leading-4 text-white shadow-soft sm:text-[11px]">
              −{discount}%
            </span>
          )}
          {lowStock && (
            <span className="rounded-full bg-ink-950/85 px-2 py-0.5 text-[10px] font-semibold leading-4 text-brass-200 backdrop-blur-sm sm:text-[11px]">
              Only {product.stock} left
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3 sm:gap-1.5 sm:p-4">
        {product.categoryName && (
          <p className="eyebrow truncate text-[10px] text-ink-400 sm:text-[11px]">
            {product.categoryName}
          </p>
        )}
        <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-ink-900 sm:text-sm">
          <Link
            href={`/products/${product.slug}`}
            className="transition-colors after:absolute after:inset-0 after:content-[''] hover:text-brand-700"
          >
            {product.name}
          </Link>
        </h3>
        <div className="mt-auto flex flex-col gap-2 pt-2 sm:flex-row sm:items-end sm:justify-between sm:pt-2.5">
          <div className=" flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 sm:block">
            <p className="text-sm font-bold leading-5 tabular-nums text-ink-900 sm:text-[17px] sm:leading-6">
              {formatINR(product.pricePaise)}
            </p>
            {onSale && (
              <p className="text-[11px] tabular-nums text-ink-400 line-through sm:mt-0.5 sm:text-xs">
                {formatINR(product.compareAtPricePaise!)}
              </p>
            )}
          </div>
          <div className="relative z-10">
            <AddToCartButton
              productId={product.id}
              disabled={soldOut}
              compact
              className="w-full sm:w-auto"
            />
          </div>
        </div>
      </div>
    </article>
  );
}
