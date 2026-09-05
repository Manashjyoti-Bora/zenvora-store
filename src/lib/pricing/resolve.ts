import { prisma } from '../db';
import type { PricingRule, ProductVariant } from '@prisma/client';
import { getSettings } from '../settings';
import { toPaise, type MoneyInput } from '../money';
import {
  computePricing,
  type PricingBreakdown,
  type PricingMode,
  type RoundingRule,
} from './engine';

/**
 * Resolves the effective pricing inputs for a product (or a specific variant)
 * by layering, in increasing precedence:
 *
 *   1. Product-level pricing fields (set by admin)
 *   2. The highest-priority matching ACTIVE pricing rule
 *      (PRODUCT scope > CATEGORY scope > SUPPLIER scope > GLOBAL scope,
 *       then by the rule's `priority` number)
 *   3. Variant-level cost overrides (only for variant-specific previews)
 *
 * Explicit variant `sellingPrice` overrides everything: when set, it is used
 * as-is (equivalent to FIXED_PRICE for that variant).
 */

export interface ProductPricingFields {
  supplierCost: MoneyInput;
  supplierShippingCost: MoneyInput;
  otherCost: MoneyInput;
  pricingMode: PricingMode;
  fixedPrice?: MoneyInput | null;
  fixedMargin?: MoneyInput | null;
  percentMarkup?: number | MoneyInput | null;
  minProfit?: MoneyInput | null;
  roundingRule: RoundingRule;
  taxRatePercent: MoneyInput | number;
  supplierId?: string | null;
  categoryId?: string | null;
  id?: string;
}

export interface VariantPricingFields {
  supplierCost?: MoneyInput | null;
  supplierShippingCost?: MoneyInput | null;
  sellingPrice?: MoneyInput | null;
  taxRatePercent?: MoneyInput | number | null;
}

const SCOPE_WEIGHT: Record<string, number> = { PRODUCT: 4, CATEGORY: 3, SUPPLIER: 2, GLOBAL: 1 };

export async function findApplicablePricingRule(product: {
  id?: string;
  supplierId?: string | null;
  categoryId?: string | null;
}): Promise<PricingRule | null> {
  const rules = await prisma.pricingRule.findMany({ where: { isActive: true } });
  const matching = rules.filter((r) => {
    switch (r.scope) {
      case 'PRODUCT':
        return r.productId !== null && r.productId === product.id;
      case 'CATEGORY':
        return r.categoryId !== null && r.categoryId === product.categoryId;
      case 'SUPPLIER':
        return r.supplierId !== null && r.supplierId === product.supplierId;
      case 'GLOBAL':
        return true;
      default:
        return false;
    }
  });
  if (matching.length === 0) return null;
  matching.sort(
    (a, b) =>
      b.priority - a.priority ||
      (SCOPE_WEIGHT[b.scope] ?? 0) - (SCOPE_WEIGHT[a.scope] ?? 0) ||
      a.createdAt.getTime() - b.createdAt.getTime()
  );
  return matching[0];
}

export interface ResolvePricingResult {
  breakdown: PricingBreakdown;
  rule: PricingRule | null;
}

/** Compute the full breakdown for a product (+ optional variant cost overrides). */
export async function resolvePricing(
  product: ProductPricingFields,
  variant?:
    | VariantPricingFields
    | Pick<
        ProductVariant,
        'supplierCost' | 'supplierShippingCost' | 'sellingPrice' | 'taxRatePercent'
      >
    | null,
  ruleOverride?: PricingRule | null
): Promise<ResolvePricingResult> {
  const settings = await getSettings();
  const rule = ruleOverride !== undefined ? ruleOverride : await findApplicablePricingRule(product);

  const mode: PricingMode = rule ? rule.mode : product.pricingMode;
  const roundingRule: RoundingRule = rule ? rule.roundingRule : product.roundingRule;

  const supplierCostPaise = toPaise(variant?.supplierCost ?? product.supplierCost);
  const supplierShippingPaise = toPaise(
    variant?.supplierShippingCost ?? product.supplierShippingCost
  );
  const taxRatePercent = Number(String(variant?.taxRatePercent ?? product.taxRatePercent ?? 0));

  const breakdown = computePricing({
    supplierCostPaise,
    supplierShippingPaise,
    otherCostPaise: toPaise(product.otherCost),
    mode,
    // Variant explicit price > product fixed price (rules never carry a
    // fixed price; a FIXED_PRICE-mode rule falls back to the product field).
    fixedPricePaise:
      variant?.sellingPrice != null
        ? toPaise(variant.sellingPrice)
        : product.fixedPrice != null
          ? toPaise(product.fixedPrice)
          : null,
    fixedMarginPaise: toNullablePaise(rule ? rule.fixedMargin : product.fixedMargin),
    percentMarkup:
      (rule ? rule.percentMarkup : product.percentMarkup) != null
        ? Number(String(rule ? rule.percentMarkup : product.percentMarkup))
        : null,
    minProfitPaise: toNullablePaise(rule ? rule.minProfit : product.minProfit),
    roundingRule,
    paymentFeePercent: settings.payments.feePercent,
    paymentFeeFixedPaise: settings.payments.feeFixedPaise,
    taxRatePercent,
  });

  return { breakdown, rule };
}

/** The authoritative selling price (paise) for a product or its variant. */
export async function effectiveSellingPricePaise(
  product: ProductPricingFields & { sellingPrice?: MoneyInput | null },
  variant?: VariantPricingFields | null
): Promise<number> {
  if (variant?.sellingPrice != null) return toPaise(variant.sellingPrice);
  if (product.sellingPrice != null && toPaise(product.sellingPrice) > 0) {
    // Stored sellingPrice is kept in sync by the catalog service on every
    // product/rule change; recompute only when missing (defensive).
    return toPaise(product.sellingPrice);
  }
  const { breakdown } = await resolvePricing(product, variant);
  return breakdown.sellingPricePaise;
}

export function toNullablePaise(value: MoneyInput | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return toPaise(value);
}
