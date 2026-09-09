'use client';

import { useState } from 'react';
import { formatINR, formatDiscountPercent } from '@/lib/money';
import { QuantityStepper } from './quantity-stepper';
import { AddToCartButton } from './add-to-cart-button';
import { Badge } from '@/components/ui/badge';

export interface BuyBoxVariant {
  id: string | null;
  label: string;
  pricePaise: number;
  compareAtPricePaise: number | null;
  stock: number;
  isActive: boolean;
}

/**
 * Product buy box: variant selection + quantity + add to cart.
 * Server-rendered prices are authoritative at checkout; this component only
 * reflects the selection.
 */
export function ProductBuyBox({
  productId,
  basePricePaise,
  baseCompareAtPaise,
  baseStock,
  variants,
  maxPerOrder = 10,
  lowStockThreshold = 5,
}: {
  productId: string;
  basePricePaise: number;
  baseCompareAtPaise: number | null;
  baseStock: number;
  variants: BuyBoxVariant[];
  maxPerOrder?: number;
  lowStockThreshold?: number;
}) {
  const activeVariants = variants.filter((v) => v.isActive);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    activeVariants.length === 1 ? activeVariants[0].id : null
  );
  const [qty, setQty] = useState(1);

  const selected = activeVariants.find((v) => v.id === selectedVariantId) ?? null;
  const pricePaise = selected ? selected.pricePaise : basePricePaise;
  const compareAtPaise = selected ? selected.compareAtPricePaise : baseCompareAtPaise;
  const stock = selected ? selected.stock : baseStock;
  const soldOut = stock === 0;
  const discount = formatDiscountPercent(pricePaise, compareAtPaise);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <p className="text-3xl font-bold tabular-nums text-gray-900">{formatINR(pricePaise)}</p>
        {compareAtPaise && compareAtPaise > pricePaise && (
          <>
            <p className="text-lg tabular-nums text-gray-400 line-through">
              {formatINR(compareAtPaise)}
            </p>
            {discount != null && <Badge tone="red">{discount}% off</Badge>}
          </>
        )}
      </div>
      <p className="text-xs text-gray-500">
        Inclusive of all applicable taxes. Shipping calculated at checkout.
      </p>

      <div aria-live="polite" className="text-sm">
        {soldOut ? (
          <Badge tone="red">Currently sold out</Badge>
        ) : lowStockThreshold > 0 && stock <= lowStockThreshold ? (
          <Badge tone="amber">Low stock — only {stock} left</Badge>
        ) : (
          <Badge tone="green">In stock</Badge>
        )}
      </div>

      {activeVariants.length > 0 && (
        <fieldset>
          <legend className="label-text mb-1.5">
            Option{activeVariants.length > 0 && selected ? `: ${selected.label}` : ''}
            {selectedVariantId === null && activeVariants.length > 1 && (
              <span className="ml-1 text-xs font-normal text-amber-600">(choose one)</span>
            )}
          </legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Product options">
            {activeVariants.map((v) => (
              <button
                key={v.id ?? 'default'}
                type="button"
                role="radio"
                aria-checked={selectedVariantId === v.id}
                onClick={() => setSelectedVariantId(v.id)}
                disabled={v.stock === 0}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  selectedVariantId === v.id
                    ? 'border-brand-600 bg-brand-50 text-brand-800'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-brand-400'
                }`}
              >
                {v.label}
                {v.stock === 0 && <span className="ml-1 text-xs text-gray-400">(sold out)</span>}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <QuantityStepper
          value={qty}
          min={1}
          max={Math.min(maxPerOrder, Math.max(stock, 1))}
          onChange={setQty}
        />
        <AddToCartButton
          productId={productId}
          variantId={selectedVariantId ?? undefined}
          qty={qty}
          disabled={soldOut || (activeVariants.length > 1 && selectedVariantId === null)}
        />
        <AddToCartButton
          productId={productId}
          variantId={selectedVariantId ?? undefined}
          qty={qty}
          disabled={soldOut || (activeVariants.length > 1 && selectedVariantId === null)}
          goToList
          label="Buy now"
        />
      </div>
    </div>
  );
}
