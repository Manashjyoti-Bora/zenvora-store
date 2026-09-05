/**
 * Structural mirrors of API response shapes used by E2E specs.
 * Kept intentionally local (not imported from src) so the specs assert the
 * wire contract, not the internal TypeScript types.
 */

export interface CartLineLike {
  itemId: string;
  productId: string;
  variantId: string | null;
  name: string;
  slug: string;
  variantName: string | null;
  image: string | null;
  unitPricePaise: number;
  quantity: number;
  lineTotalPaise: number;
  available: boolean;
  maxQuantity: number;
}

export interface CartLike {
  cartId: string;
  lines: CartLineLike[];
  itemCount: number;
  subtotalPaise: number;
  coupon: { code: string; discountPaise: number } | null;
  couponError: string | null;
  shippingPaise: number;
  freeShippingApplied: boolean;
  freeShippingThresholdPaise: number;
  grandTotalPaise: number;
  isEmpty: boolean;
}
