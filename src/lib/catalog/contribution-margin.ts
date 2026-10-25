/**
 * Transparent contribution margin for a supplier candidate or catalogue product.
 *
 *   contribution = selling price (ex-GST)
 *                − supplier cost − supplier shipping
 *                − payment fees − fulfilment (packaging + operations)
 *                − estimated return loss − other known costs
 *
 * Every line carries a `basis` so the owner can see what is a supplier quote,
 * what is a configured assumption and what is a realised figure. Nothing here
 * is a forecast of demand; it is pure unit economics on the inputs given.
 */

export type MarginLineBasis =
  /** Taken from the supplier feed / quote at the time of evaluation. */
  | 'SUPPLIER_QUOTE'
  /** Store configuration (settings / pricing rule). */
  | 'CONFIGURED'
  /** Derived estimate (rate × base); will differ from the realised figure. */
  | 'ESTIMATE'
  /** Recorded from an actual order/payment/supplier invoice. */
  | 'REALIZED'
  /** Input not available — treated as 0 and listed under `unknowns`. */
  | 'UNKNOWN';

export interface MarginLine {
  key:
    | 'sellingPrice'
    | 'gst'
    | 'supplierCost'
    | 'supplierShipping'
    | 'paymentFees'
    | 'fulfilment'
    | 'estimatedReturnLoss'
    | 'otherKnownCosts';
  label: string;
  /** Positive for revenue, negative for costs. */
  amountPaise: number;
  basis: MarginLineBasis;
  note: string;
}

export interface ContributionMarginInput {
  /** Customer-facing price including GST (what the shopper pays for one unit). */
  sellingPricePaise: number;
  supplierCostPaise: number | null;
  supplierShippingPaise: number | null;
  /** GST percentage embedded in the selling price (0 when not configured). */
  taxRatePercent?: number;
  paymentFeePercent?: number;
  paymentFeeFixedPaise?: number;
  /** Packaging + operational overhead per unit, from settings. */
  packagingPaise?: number;
  operationalPaise?: number;
  /** Return-loss provision as a percentage of (cost + shipping). */
  returnReservePercent?: number;
  otherKnownCostsPaise?: number;
  /**
   * Realised figures, when known (e.g. after a payment is captured and a
   * supplier order is invoiced). They override the matching estimate and mark
   * the line REALIZED.
   */
  realized?: {
    paymentFeePaise?: number | null;
    supplierCostPaise?: number | null;
    supplierShippingPaise?: number | null;
  };
}

export interface ContributionMarginResult {
  lines: MarginLine[];
  /** Net revenue after GST (the base the contribution % is computed on). */
  netRevenuePaise: number;
  totalCostPaise: number;
  contributionPaise: number;
  /** Contribution as a % of net (ex-GST) revenue; 0 when revenue is 0. */
  contributionPercent: number;
  /** Which lines are estimates vs realised — summarised for the UI. */
  basisSummary: { estimated: number; realized: number; unknown: number };
  /** Inputs that were missing and therefore treated as zero. */
  unknowns: string[];
  /** True when any cost input was missing — the figure is an upper bound. */
  isUpperBound: boolean;
}

const r = (n: number) => Math.round(n);

export function computeContributionMargin(input: ContributionMarginInput): ContributionMarginResult {
  const selling = Math.max(0, r(input.sellingPricePaise || 0));
  const taxPct = Math.max(0, input.taxRatePercent ?? 0);
  const gst = taxPct > 0 ? r(selling - selling / (1 + taxPct / 100)) : 0;
  const netRevenue = selling - gst;

  const unknowns: string[] = [];
  const lines: MarginLine[] = [];

  lines.push({
    key: 'sellingPrice',
    label: 'Selling price (incl. GST)',
    amountPaise: selling,
    basis: 'CONFIGURED',
    note: 'Customer price after pricing rule and rounding.',
  });
  lines.push({
    key: 'gst',
    label: `GST (${taxPct}%)`,
    amountPaise: -gst,
    basis: taxPct > 0 ? 'CONFIGURED' : 'UNKNOWN',
    note:
      taxPct > 0
        ? 'Embedded in the selling price; remitted, not revenue.'
        : 'No GST rate configured — treated as 0. Set tax.defaultGstPercent.',
  });
  if (taxPct <= 0) unknowns.push('GST rate');

  // Supplier cost
  const realizedCost = input.realized?.supplierCostPaise;
  if (realizedCost != null) {
    lines.push({
      key: 'supplierCost',
      label: 'Supplier cost',
      amountPaise: -r(realizedCost),
      basis: 'REALIZED',
      note: 'From the supplier order / invoice.',
    });
  } else if (input.supplierCostPaise != null && input.supplierCostPaise > 0) {
    lines.push({
      key: 'supplierCost',
      label: 'Supplier cost',
      amountPaise: -r(input.supplierCostPaise),
      basis: 'SUPPLIER_QUOTE',
      note: 'Supplier feed price at evaluation time.',
    });
  } else {
    lines.push({
      key: 'supplierCost',
      label: 'Supplier cost',
      amountPaise: 0,
      basis: 'UNKNOWN',
      note: 'Supplier cost missing — candidate is not priceable.',
    });
    unknowns.push('supplier cost');
  }

  // Supplier shipping to India
  const realizedShip = input.realized?.supplierShippingPaise;
  if (realizedShip != null) {
    lines.push({
      key: 'supplierShipping',
      label: 'Supplier shipping (to customer)',
      amountPaise: -r(realizedShip),
      basis: 'REALIZED',
      note: 'From the supplier order / invoice.',
    });
  } else if (input.supplierShippingPaise != null) {
    lines.push({
      key: 'supplierShipping',
      label: 'Supplier shipping (to customer)',
      amountPaise: -r(input.supplierShippingPaise),
      basis: 'SUPPLIER_QUOTE',
      note: 'Supplier freight quote for an India delivery.',
    });
  } else {
    lines.push({
      key: 'supplierShipping',
      label: 'Supplier shipping (to customer)',
      amountPaise: 0,
      basis: 'UNKNOWN',
      note: 'No India shipping quote — margin is an upper bound until one exists.',
    });
    unknowns.push('supplier shipping');
  }

  // Payment fees
  const feePct = Math.max(0, input.paymentFeePercent ?? 0);
  const feeFixed = Math.max(0, input.paymentFeeFixedPaise ?? 0);
  const realizedFee = input.realized?.paymentFeePaise;
  if (realizedFee != null) {
    lines.push({
      key: 'paymentFees',
      label: 'Payment gateway fees',
      amountPaise: -r(realizedFee),
      basis: 'REALIZED',
      note: 'Fee reported by the gateway for the captured payment.',
    });
  } else {
    const fee = r((selling * feePct) / 100 + feeFixed);
    lines.push({
      key: 'paymentFees',
      label: 'Payment gateway fees',
      amountPaise: -fee,
      basis: feePct > 0 || feeFixed > 0 ? 'ESTIMATE' : 'UNKNOWN',
      note:
        feePct > 0 || feeFixed > 0
          ? `${feePct}% of price + ₹${(feeFixed / 100).toFixed(2)} fixed (COD orders carry the COD fee instead).`
          : 'No payment fee configured — treated as 0.',
    });
    if (!(feePct > 0 || feeFixed > 0)) unknowns.push('payment fee rate');
  }

  // Fulfilment overhead
  const fulfil = Math.max(0, r((input.packagingPaise ?? 0) + (input.operationalPaise ?? 0)));
  lines.push({
    key: 'fulfilment',
    label: 'Fulfilment (packaging + operations)',
    amountPaise: -fulfil,
    basis: 'CONFIGURED',
    note: 'pricing.packagingPaise + pricing.operationalPaise per unit.',
  });

  // Estimated return loss
  const reservePct = Math.max(0, input.returnReservePercent ?? 0);
  const reserveBase =
    (realizedCost ?? input.supplierCostPaise ?? 0) + (realizedShip ?? input.supplierShippingPaise ?? 0);
  const returnLoss = r((Math.max(0, reserveBase) * reservePct) / 100);
  lines.push({
    key: 'estimatedReturnLoss',
    label: `Estimated return loss (${reservePct}% of landed cost)`,
    amountPaise: -returnLoss,
    basis: 'ESTIMATE',
    note:
      reservePct > 0
        ? 'Provision from pricing.returnReservePercent. No per-product return rate is available; this is NOT a measured return rate.'
        : 'No return provision configured. Returns on COD orders are a real cost — consider setting pricing.returnReservePercent.',
  });

  const other = Math.max(0, r(input.otherKnownCostsPaise ?? 0));
  lines.push({
    key: 'otherKnownCosts',
    label: 'Other known costs',
    amountPaise: -other,
    basis: 'CONFIGURED',
    note: other > 0 ? 'Product-level otherCost.' : 'None recorded.',
  });

  const totalCost = lines
    .filter((l) => l.key !== 'sellingPrice' && l.key !== 'gst')
    .reduce((acc, l) => acc + -l.amountPaise, 0);
  const contribution = netRevenue - totalCost;
  const contributionPercent = netRevenue > 0 ? Math.round((contribution / netRevenue) * 1000) / 10 : 0;

  const basisSummary = {
    estimated: lines.filter((l) => l.basis === 'ESTIMATE').length,
    realized: lines.filter((l) => l.basis === 'REALIZED').length,
    unknown: lines.filter((l) => l.basis === 'UNKNOWN').length,
  };

  return {
    lines,
    netRevenuePaise: netRevenue,
    totalCostPaise: totalCost,
    contributionPaise: contribution,
    contributionPercent,
    basisSummary,
    unknowns,
    isUpperBound: unknowns.some((u) => u === 'supplier shipping' || u === 'supplier cost'),
  };
}
