import { assertIntegerPaise, percentOfPaise } from '../money';

/**
 * ============================================================================
 * PRICING / MARGIN ENGINE (pure functions, integer paise arithmetic)
 * ============================================================================
 *
 * Terminology (deliberately kept distinct - the UI must use these labels):
 *
 * - TOTAL COST (landed cost)  = supplier cost + supplier shipping + other costs
 * - MARKUP %                  = percent added ON TOP OF the total cost
 *                               selling = totalCost * (1 + markup/100)
 * - GROSS MARGIN              = selling price - total cost        (rupees)
 * - EFFECTIVE MARGIN %        = gross margin / selling price      (percent)
 * - ESTIMATED NET PROFIT      = gross margin - estimated payment gateway fees
 *
 * Markup% and margin% are NOT the same number and are never presented as
 * such: a 30% markup on cost yields a ~23.1% margin on the selling price.
 *
 * All inputs/outputs are integer paise (1 rupee = 100 paise).
 */

export type PricingMode = 'FIXED_PRICE' | 'FIXED_MARGIN' | 'PERCENT_MARKUP';
export type RoundingRule = 'NONE' | 'ROUND_UP_10' | 'NEAREST_9' | 'NEAREST_99';

export interface PricingInput {
  supplierCostPaise: number;
  supplierShippingPaise: number;
  otherCostPaise: number;
  mode: PricingMode;
  fixedPricePaise?: number | null;
  fixedMarginPaise?: number | null;
  percentMarkup?: number | null;
  /** Minimum gross margin floor (selling - total cost). Price is raised if needed. */
  minProfitPaise?: number | null;
  roundingRule?: RoundingRule;
  /** Estimated gateway fee used for profit forecasts (settings.payments). */
  paymentFeePercent?: number;
  paymentFeeFixedPaise?: number;
  /** GST rate included in the selling price (Indian B2C display convention). */
  taxRatePercent?: number;
}

export interface PricingBreakdown {
  totalCostPaise: number;
  rawPricePaise: number;
  sellingPricePaise: number;
  grossMarginPaise: number;
  effectiveMarginPercent: number;
  markupOnCostPercent: number | null;
  estimatedPaymentFeePaise: number;
  estimatedNetProfitPaise: number;
  taxComponentPaise: number;
  minProfitApplied: boolean;
  belowCost: boolean;
  warnings: string[];
}

const MIN_SELLING_PAISE = 100; // ₹1

export function computePricing(input: PricingInput): PricingBreakdown {
  const {
    supplierCostPaise,
    supplierShippingPaise,
    otherCostPaise,
    mode,
    minProfitPaise = null,
    roundingRule = 'NONE',
    paymentFeePercent = 0,
    paymentFeeFixedPaise = 0,
    taxRatePercent = 0,
  } = input;

  for (const [label, v] of Object.entries({
    supplierCostPaise,
    supplierShippingPaise,
    otherCostPaise,
  })) {
    assertIntegerPaise(v);
    if (v < 0) throw new Error(`${label} cannot be negative`);
  }

  const totalCostPaise = supplierCostPaise + supplierShippingPaise + otherCostPaise;
  const warnings: string[] = [];

  let rawPricePaise: number;
  switch (mode) {
    case 'FIXED_PRICE': {
      if (input.fixedPricePaise == null)
        throw new Error('fixedPricePaise is required for FIXED_PRICE mode');
      assertIntegerPaise(input.fixedPricePaise);
      rawPricePaise = input.fixedPricePaise;
      break;
    }
    case 'FIXED_MARGIN': {
      if (input.fixedMarginPaise == null)
        throw new Error('fixedMarginPaise is required for FIXED_MARGIN mode');
      assertIntegerPaise(input.fixedMarginPaise);
      rawPricePaise = totalCostPaise + input.fixedMarginPaise;
      break;
    }
    case 'PERCENT_MARKUP': {
      const pct = input.percentMarkup;
      if (pct == null || !Number.isFinite(pct) || pct < 0) {
        throw new Error('A non-negative percentMarkup is required for PERCENT_MARKUP mode');
      }
      rawPricePaise = totalCostPaise + Math.round((totalCostPaise * pct) / 100);
      break;
    }
    default:
      throw new Error(`Unknown pricing mode: ${String(mode)}`);
  }

  if (rawPricePaise < MIN_SELLING_PAISE) {
    rawPricePaise = MIN_SELLING_PAISE;
    warnings.push('Calculated price was below the ₹1 minimum and was raised.');
  }

  let sellingPricePaise = applyRounding(rawPricePaise, roundingRule);

  // Enforce minimum profit floor AFTER rounding (rounding may erode margin).
  let minProfitApplied = false;
  if (minProfitPaise != null && minProfitPaise > 0) {
    assertIntegerPaise(minProfitPaise);
    const floorPrice = totalCostPaise + minProfitPaise;
    if (sellingPricePaise < floorPrice) {
      sellingPricePaise = Math.max(floorPrice, ceilToRupee(floorPrice));
      minProfitApplied = true;
      warnings.push('Price was raised to meet the configured minimum profit floor.');
    }
  }

  const grossMarginPaise = sellingPricePaise - totalCostPaise;
  const belowCost = grossMarginPaise < 0;
  if (belowCost)
    warnings.push('Selling price is BELOW total cost - this product would lose money.');

  const estimatedPaymentFeePaise =
    percentOfPaise(sellingPricePaise, paymentFeePercent) + paymentFeeFixedPaise;
  const estimatedNetProfitPaise = grossMarginPaise - estimatedPaymentFeePaise;
  if (!belowCost && estimatedNetProfitPaise < 0) {
    warnings.push('After estimated payment gateway fees, net profit would be negative.');
  }

  const effectiveMarginPercent =
    sellingPricePaise > 0 ? round2((grossMarginPaise / sellingPricePaise) * 100) : 0;
  const markupOnCostPercent =
    totalCostPaise > 0
      ? round2(((sellingPricePaise - totalCostPaise) / totalCostPaise) * 100)
      : null;

  const taxComponentPaise =
    taxRatePercent > 0
      ? Math.round((sellingPricePaise * taxRatePercent) / (100 + taxRatePercent))
      : 0;

  return {
    totalCostPaise,
    rawPricePaise,
    sellingPricePaise,
    grossMarginPaise,
    effectiveMarginPercent,
    markupOnCostPercent,
    estimatedPaymentFeePaise,
    estimatedNetProfitPaise,
    taxComponentPaise,
    minProfitApplied,
    belowCost,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Rounding rules (applied at whole-rupee granularity)
// ---------------------------------------------------------------------------

export function applyRounding(pricePaise: number, rule: RoundingRule): number {
  assertIntegerPaise(pricePaise);
  switch (rule) {
    case 'NONE':
      return pricePaise;
    case 'ROUND_UP_10': {
      const step = 1000; // ₹10
      return Math.ceil(pricePaise / step) * step;
    }
    case 'NEAREST_9':
      return nearestEndingIn(pricePaise, 9, 1000);
    case 'NEAREST_99':
      return nearestEndingIn(pricePaise, 99, 10000);
    default:
      return pricePaise;
  }
}

/**
 * Psychological-price rounding: find the nearest price whose rupee amount
 * ends with the given suffix (9 -> x9, 99 -> x99). Ties round up.
 * e.g. NEAREST_9: 391 -> 389, 395 -> 399, 400 -> 399
 *      NEAREST_99: 460 -> 499? no -> nearest of {399, 499} = 499? |460-399|=61, |499-460|=39 -> 499
 */
function nearestEndingIn(pricePaise: number, suffix: number, modulus: number): number {
  // suffix 9 => last rupee digit 9 (mod 100 paise == 900); 99 => mod 10000 == 9900
  const target = suffix === 9 ? 900 : 9900;
  const base = Math.floor(pricePaise / modulus) * modulus; // lower window start
  const lower = base - modulus + target; // candidate ending in suffix below window top
  const candidates = [lower, base + target, base + modulus + target].filter((c) => c >= 100);
  let best = candidates[0];
  let bestDist = Math.abs(pricePaise - best);
  for (const c of candidates) {
    const dist = Math.abs(pricePaise - c);
    if (dist < bestDist || (dist === bestDist && c > best)) {
      best = c;
      bestDist = dist;
    }
  }
  return best;
}

export function ceilToRupee(paise: number): number {
  return Math.ceil(paise / 100) * 100;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Order-line helpers (tax-inclusive pricing, Indian GST convention)
// ---------------------------------------------------------------------------

/** Extract the GST component from a tax-inclusive amount. */
export function taxComponentOf(amountPaise: number, taxRatePercent: number): number {
  if (taxRatePercent <= 0) return 0;
  return Math.round((amountPaise * taxRatePercent) / (100 + taxRatePercent));
}

/** Distribute a total discount across line totals proportionally (integer
 *  safe: the remainder is added to the largest line so sums always match). */
export function prorateDiscount(lineTotalsPaise: number[], discountPaise: number): number[] {
  const total = lineTotalsPaise.reduce((a, b) => a + b, 0);
  if (total <= 0 || discountPaise <= 0) return lineTotalsPaise.map(() => 0);
  const capped = Math.min(discountPaise, total);
  const shares = lineTotalsPaise.map((l) => Math.floor((l * capped) / total));
  let remainder = capped - shares.reduce((a, b) => a + b, 0);
  // Give the remainder to the largest lines first (deterministic).
  const order = lineTotalsPaise
    .map((v, i) => i)
    .sort((a, b) => lineTotalsPaise[b] - lineTotalsPaise[a]);
  let idx = 0;
  while (remainder > 0 && order.length > 0) {
    const i = order[idx % order.length];
    shares[i] += 1;
    remainder -= 1;
    idx += 1;
  }
  return shares;
}
