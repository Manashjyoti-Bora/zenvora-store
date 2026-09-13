import type { StoreSettings } from '../settings';
import { percentOfPaise } from '../money';
import { taxComponentOf } from '../pricing/engine';

/**
 * Checkout total calculation (pure). All amounts are integer paise.
 * Selling prices are TAX-INCLUSIVE (standard Indian B2C display), so the tax
 * total is the GST component extracted from prices, not added on top.
 */

export interface CheckoutLine {
  key: string;
  unitPricePaise: number;
  quantity: number;
  taxRatePercent: number;
  /** Landed cost per unit: supplier cost + supplier shipping + other costs. */
  unitLandedCostPaise: number;
  categoryEligible?: boolean;
}

export interface ShippingCalc {
  shippingPaise: number;
  codFeePaise: number;
  freeShippingApplied: boolean;
}

export function calcShipping(
  subtotalAfterDiscountPaise: number,
  settings: StoreSettings,
  paymentMethod: 'PREPAID_GATEWAY' | 'COD'
): ShippingCalc {
  const { flatRatePaise, freeAbovePaise, codEnabled, codFeePaise } = settings.shipping;
  const freeShippingApplied =
    freeAbovePaise > 0 && subtotalAfterDiscountPaise >= freeAbovePaise && flatRatePaise > 0;
  const shippingPaise = freeShippingApplied || flatRatePaise === 0 ? 0 : flatRatePaise;
  return {
    shippingPaise,
    codFeePaise: paymentMethod === 'COD' && codEnabled ? codFeePaise : 0,
    freeShippingApplied,
  };
}

export interface TotalsCalc {
  subtotalPaise: number;
  discountTotalPaise: number;
  shippingPaise: number;
  codFeePaise: number;
  taxTotalPaise: number;
  grandTotalPaise: number;
  supplierCostTotalPaise: number;
  lineDiscountsPaise: number[];
  lineTaxesPaise: number[];
  lineTotalsPaise: number[];
}

export function calcTotals(params: {
  lines: CheckoutLine[];
  discountTotalPaise: number;
  shipping: ShippingCalc;
  lineDiscountsPaise: number[];
}): TotalsCalc {
  const { lines, discountTotalPaise, shipping, lineDiscountsPaise } = params;

  const lineTotalsPaise = lines.map((l) => l.unitPricePaise * l.quantity);
  const subtotalPaise = lineTotalsPaise.reduce((a, b) => a + b, 0);

  // Tax is computed on the post-discount line amount (tax-inclusive extraction).
  const lineTaxesPaise = lines.map((l, i) =>
    taxComponentOf(Math.max(0, lineTotalsPaise[i] - (lineDiscountsPaise[i] ?? 0)), l.taxRatePercent)
  );
  const taxTotalPaise = lineTaxesPaise.reduce((a, b) => a + b, 0);

  const supplierCostTotalPaise = lines.reduce((a, l) => a + l.unitLandedCostPaise * l.quantity, 0);

  const grandTotalPaise =
    subtotalPaise - discountTotalPaise + shipping.shippingPaise + shipping.codFeePaise;

  return {
    subtotalPaise,
    discountTotalPaise,
    shippingPaise: shipping.shippingPaise,
    codFeePaise: shipping.codFeePaise,
    taxTotalPaise,
    grandTotalPaise,
    supplierCostTotalPaise,
    lineDiscountsPaise,
    lineTaxesPaise,
    lineTotalsPaise,
  };
}

/** Estimated gateway fee for a given order amount (settings-driven). */
export function estimatePaymentFeePaise(amountPaise: number, settings: StoreSettings): number {
  return (
    percentOfPaise(amountPaise, settings.payments.feePercent) + settings.payments.feeFixedPaise
  );
}
