import { percentOfPaise } from '../money';
import type { StoreSettings } from '../settings';
import {
  computePricing,
  type PricingBreakdown,
  type PricingInput,
  type PricingMode,
  type RoundingRule,
} from './engine';
import { findApplicablePricingRule, resolvePricing, type ProductPricingFields } from './resolve';

/**
 * ============================================================================
 * PRICING FACADE - the single public surface for every money calculation.
 * ============================================================================
 *
 * The spec-named functions below are thin, deterministic wrappers over the
 * pure engine (`./engine`) plus store settings. No pricing math lives anywhere
 * else: checkout, catalogue, admin previews and reports all call into here.
 *
 * Cost model (all integer paise):
 *   landedCost = supplierCost + supplierShipping + packaging + operational
 *   totalCost  = landedCost + returnReserve(return/RTO reserve)
 *   price      = f(totalCost, mode, markup/margin, rounding, min-profit floor)
 *
 * Margin protection:
 *   minSafePrice(cost) = ceil(cost / (1 - minMarginPercent/100))
 *   Discounts (coupons/campaigns) are capped so the final price never drops
 *   below minSafePrice unless the coupon explicitly bypasses protection AND
 *   the admin enabled such overrides.
 */

export interface CostInput {
  supplierCostPaise: number;
  supplierShippingPaise: number;
  /** Packaging + operational overheads (from settings by default). */
  packagingPaise?: number;
  operationalPaise?: number;
  /** Return/RTO reserve in paise (computed from percent by calculateReturnReserve). */
  returnReservePaise?: number;
}

/** TOTAL estimated cost used everywhere: landed + reserves. */
export function calculateCost(input: CostInput): number {
  return (
    input.supplierCostPaise +
    input.supplierShippingPaise +
    (input.packagingPaise ?? 0) +
    (input.operationalPaise ?? 0) +
    (input.returnReservePaise ?? 0)
  );
}

/** Markup percent ON TOP of total cost for a given selling price. */
export function calculateMarkup(totalCostPaise: number, sellingPricePaise: number): number {
  if (totalCostPaise <= 0) return 0;
  return round2(((sellingPricePaise - totalCostPaise) / totalCostPaise) * 100);
}

/** Effective margin percent ON the selling price (never the same as markup). */
export function calculateMargin(totalCostPaise: number, sellingPricePaise: number): number {
  if (sellingPricePaise <= 0) return 0;
  return round2(((sellingPricePaise - totalCostPaise) / sellingPricePaise) * 100);
}

/** Estimated net profit: gross margin minus estimated payment fee. */
export function calculateProfit(
  totalCostPaise: number,
  sellingPricePaise: number,
  settings: StoreSettings
): number {
  const fee = calculatePaymentFee(sellingPricePaise, settings);
  return sellingPricePaise - totalCostPaise - fee;
}

/** Estimated gateway fee for an amount (settings-driven). */
export function calculatePaymentFee(amountPaise: number, settings: StoreSettings): number {
  return percentOfPaise(amountPaise, settings.payments.feePercent) + settings.payments.feeFixedPaise;
}

/** COD impact: the configured COD fee added to COD orders (0 when disabled). */
export function calculateCODImpact(settings: StoreSettings, paymentMethod: 'PREPAID' | 'COD'): number {
  if (paymentMethod !== 'COD' || !settings.shipping.codEnabled) return 0;
  return settings.shipping.codFeePaise;
}

/** Return/RTO reserve (paise) for a landed cost, from settings percent. */
export function calculateReturnReserve(landedCostPaise: number, settings: StoreSettings): number {
  return percentOfPaise(landedCostPaise, settings.pricing.returnReservePercent);
}

/** Recommended selling price for a target fixed profit over total cost. */
export function calculateSellingPrice(params: {
  totalCostPaise: number;
  targetProfitPaise?: number | null;
  targetMarginPercent?: number | null;
  roundingRule?: RoundingRule;
  settings?: StoreSettings | null;
}): number {
  const { totalCostPaise, targetProfitPaise, targetMarginPercent, roundingRule } = params;
  let raw: number;
  if (targetMarginPercent != null && targetMarginPercent > 0 && targetMarginPercent < 100) {
    raw = Math.ceil(totalCostPaise / (1 - targetMarginPercent / 100));
  } else {
    raw = totalCostPaise + (targetProfitPaise ?? 0);
  }
  const breakdown = computePricing({
    supplierCostPaise: totalCostPaise,
    supplierShippingPaise: 0,
    otherCostPaise: 0,
    mode: 'FIXED_PRICE',
    fixedPricePaise: raw,
    roundingRule: roundingRule ?? 'NONE',
    minProfitPaise: targetProfitPaise ?? null,
    paymentFeePercent: params.settings?.payments.feePercent ?? 0,
    paymentFeeFixedPaise: params.settings?.payments.feeFixedPaise ?? 0,
  });
  return breakdown.sellingPricePaise;
}

/** Discount amount (paise) for percent/fixed discounts, capped by maxDiscountPercent. */
export function calculateDiscount(params: {
  eligibleSubtotalPaise: number;
  type: 'PERCENT' | 'FIXED';
  valuePaise: number;
  capPaise?: number | null;
  settings?: StoreSettings | null;
}): number {
  const base =
    params.type === 'PERCENT'
      ? percentOfPaise(params.eligibleSubtotalPaise, params.valuePaise)
      : Math.min(params.valuePaise, params.eligibleSubtotalPaise);
  const globalCap = params.settings
    ? percentOfPaise(params.eligibleSubtotalPaise, params.settings.pricing.maxDiscountPercent)
    : params.eligibleSubtotalPaise;
  return Math.max(0, Math.min(base, params.capPaise ?? Infinity, globalCap));
}

/** Final payable price after discount (never below the margin floor unless bypassed). */
export function calculateFinalPrice(params: {
  pricePaise: number;
  discountPaise: number;
  minSafePricePaise?: number | null;
  bypassMarginProtection?: boolean;
}): { finalPricePaise: number; appliedDiscountPaise: number; capped: boolean } {
  const floor = params.bypassMarginProtection ? 0 : (params.minSafePricePaise ?? 0);
  const maxDiscount = Math.max(0, params.pricePaise - floor);
  const applied = Math.min(params.discountPaise, maxDiscount);
  return {
    finalPricePaise: params.pricePaise - applied,
    appliedDiscountPaise: applied,
    capped: applied < params.discountPaise,
  };
}

/** The price below which margin protection trips for a given total cost. */
export function minSafePricePaise(totalCostPaise: number, settings: StoreSettings): number {
  if (!settings.pricing.marginProtectionEnabled) return 0;
  const m = settings.pricing.minMarginPercent;
  if (m <= 0) return totalCostPaise;
  return Math.ceil(totalCostPaise / (1 - m / 100));
}

/**
 * Validation gate used by coupon evaluation AND order creation: returns the
 * allowed discount so the effective margin never drops below the configured
 * minimum - unless explicitly bypassed by an admin-flagged coupon.
 */
export function validateMinimumMargin(params: {
  subtotalPaise: number;
  totalCostPaise: number;
  requestedDiscountPaise: number;
  bypass: boolean;
  settings: StoreSettings;
}): { allowedDiscountPaise: number; capped: boolean; floorPaise: number } {
  const floor = minSafePricePaise(params.totalCostPaise, params.settings);
  if (params.bypass || !params.settings.pricing.marginProtectionEnabled) {
    return {
      allowedDiscountPaise: Math.min(params.requestedDiscountPaise, params.subtotalPaise),
      capped: false,
      floorPaise: floor,
    };
  }
  const allowed = Math.max(0, Math.min(params.requestedDiscountPaise, params.subtotalPaise - floor));
  return { allowedDiscountPaise: allowed, capped: allowed < params.requestedDiscountPaise, floorPaise: floor };
}

/** Deterministic rule hierarchy: PRODUCT > CATEGORY > SUPPLIER > GLOBAL > product defaults. */
export async function resolvePricingRule(product: {
  id?: string;
  supplierId?: string | null;
  categoryId?: string | null;
}) {
  return findApplicablePricingRule(product);
}

/** Full audited breakdown for a product (admin previews + catalogue sync). */
export async function explainPricing(
  product: ProductPricingFields,
  variant?: Parameters<typeof resolvePricing>[1]
): Promise<{ breakdown: PricingBreakdown; ruleId: string | null; ruleScope: string | null }> {
  const { breakdown, rule } = await resolvePricing(product, variant);
  return { breakdown, ruleId: rule?.id ?? null, ruleScope: rule?.scope ?? null };
}

export type { PricingBreakdown, PricingInput, PricingMode, RoundingRule };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
