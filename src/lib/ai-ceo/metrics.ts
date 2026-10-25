import type { EvidenceBasis, Metric, OrderLedgerRow, SalesReport } from './contracts';

/**
 * Verified commerce metrics.
 *
 * The rule this module enforces: money collected is not profit, and a missing
 * cost is not a zero cost. Contribution is reported as `null` whenever the
 * recorded cost data cannot support the subtraction, and the caveats say why.
 */

const PAID_STATUSES = new Set(['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']);
const CANCELLED_STATUSES = new Set(['CANCELLED']);

export function isRealisedPayment(row: Pick<OrderLedgerRow, 'paymentStatus'>): boolean {
  return PAID_STATUSES.has(row.paymentStatus);
}

export function hasRecordedCost(row: OrderLedgerRow): boolean {
  return (
    row.supplierCostTotalPaise > 0 ||
    row.shippingCostTotalPaise > 0 ||
    row.paymentFeeTotalPaise > 0 ||
    row.otherCostTotalPaise > 0
  );
}

function percent(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return Math.round((part / whole) * 10_000) / 100; // 2 dp
}

export function moneyMetric(
  key: string,
  label: string,
  valuePaise: number | null,
  basis: EvidenceBasis,
  source: string,
  note?: string
): Metric {
  return { key, label, valuePaise, valueCount: null, basis, source, ...(note ? { note } : {}) };
}

export function countMetric(
  key: string,
  label: string,
  valueCount: number | null,
  basis: EvidenceBasis,
  source: string,
  note?: string
): Metric {
  return { key, label, valuePaise: null, valueCount, basis, source, ...(note ? { note } : {}) };
}

/**
 * Sales/contribution analysis over the orders placed inside the window.
 * Pure: the same rows always produce the same report.
 */
export function computeSalesReport(rows: OrderLedgerRow[], windowDays: number, truncated = false): SalesReport {
  const caveats: string[] = [];
  if (truncated) {
    caveats.push('The order query hit its row cap, so these totals are a floor, not a complete figure.');
  }

  const realised = rows.filter(isRealisedPayment);
  const codCommitted = rows.filter(
    (r) => r.paymentMethod === 'COD' && r.paymentStatus === 'COD_PENDING' && !CANCELLED_STATUSES.has(r.status)
  );
  const cancelled = rows.filter((r) => CANCELLED_STATUSES.has(r.status) || r.cancelledAt !== null);

  const grossPaidRevenuePaise = realised.reduce((sum, r) => sum + r.grandTotalPaise, 0);
  const refundedPaise = realised.reduce((sum, r) => sum + Math.min(r.refundedTotalPaise, r.grandTotalPaise), 0);
  const netRevenuePaise = grossPaidRevenuePaise - refundedPaise;

  const supplierCostPaise = realised.reduce((sum, r) => sum + r.supplierCostTotalPaise, 0);
  const shippingCostPaise = realised.reduce((sum, r) => sum + r.shippingCostTotalPaise, 0);
  const paymentFeePaise = realised.reduce((sum, r) => sum + r.paymentFeeTotalPaise, 0);
  const otherCostPaise = realised.reduce((sum, r) => sum + r.otherCostTotalPaise, 0);
  const totalCostPaise = supplierCostPaise + shippingCostPaise + paymentFeePaise + otherCostPaise;

  const revenueWithCosts = realised
    .filter(hasRecordedCost)
    .reduce((sum, r) => sum + r.grandTotalPaise, 0);
  const costCoverage = grossPaidRevenuePaise > 0 ? revenueWithCosts / grossPaidRevenuePaise : 0;

  // Contribution is only a number when costs exist for the revenue it subtracts from.
  let contributionPaise: number | null = null;
  let contributionMarginPercent: number | null = null;
  let basis: EvidenceBasis = 'UNKNOWN';

  if (grossPaidRevenuePaise > 0 && costCoverage > 0) {
    contributionPaise = netRevenuePaise - totalCostPaise;
    contributionMarginPercent = percent(contributionPaise, netRevenuePaise);
    basis = costCoverage >= 0.999 ? 'DERIVED' : 'ESTIMATE';
    if (costCoverage < 0.999) {
      caveats.push(
        `Supplier/gateway costs are recorded for ${Math.round(costCoverage * 100)}% of realised revenue; contribution is an upper bound until the remainder is booked.`
      );
    }
  } else if (grossPaidRevenuePaise > 0) {
    caveats.push(
      'No supplier, shipping or gateway cost is recorded against any realised order yet, so contribution and margin cannot be calculated. Revenue is shown, profitability is unknown.'
    );
  } else {
    caveats.push('No realised (paid) order inside the window, so there is no revenue or margin to report.');
  }

  if (realised.length > 0 && realised.length < 5) {
    caveats.push(
      `Only ${realised.length} realised order(s) in the window — a sample this small does not establish a trend or a reliable margin.`
    );
  }
  if (codCommitted.length > 0) {
    caveats.push(
      `${codCommitted.length} cash-on-delivery order(s) are committed but not collected; they are excluded from revenue until delivery is marked paid.`
    );
  }

  const ordersWithCosts = realised.filter(hasRecordedCost).length;
  const averageOrderValuePaise = realised.length > 0 ? Math.round(grossPaidRevenuePaise / realised.length) : null;
  const discountPaise = realised.reduce((sum, r) => sum + r.discountTotalPaise, 0);

  const metrics: Metric[] = [
    moneyMetric('grossPaidRevenue', 'Gross realised revenue', grossPaidRevenuePaise, 'DERIVED', 'orders.grandTotal where paymentStatus = PAID*', 'Money collected, before refunds. Not profit.'),
    moneyMetric('refunded', 'Refunded', refundedPaise, 'VERIFIED', 'orders.refundedTotal', 'Amount already refunded against realised orders.'),
    moneyMetric('netRevenue', 'Net revenue', netRevenuePaise, 'DERIVED', 'gross realised − refunded', undefined),
    moneyMetric(
      'contribution',
      'Contribution (before overheads)',
      contributionPaise,
      contributionPaise === null ? 'UNKNOWN' : basis,
      'net revenue − supplier − shipping − gateway fees − other recorded costs',
      contributionPaise === null ? 'Cost data insufficient — profitability unknown.' : 'Excludes fixed business overheads and salaries.'
    ),
    moneyMetric('discounts', 'Discounts given', discountPaise, 'VERIFIED', 'orders.discountTotal', undefined),
    moneyMetric('aov', 'Average order value', averageOrderValuePaise, realised.length > 0 ? 'DERIVED' : 'UNKNOWN', 'gross realised ÷ realised orders', undefined),
    countMetric('paidOrders', 'Realised orders', realised.length, 'VERIFIED', 'orders.paymentStatus = PAID*', undefined),
    countMetric('codCommitted', 'COD committed (not collected)', codCommitted.length, 'VERIFIED', 'orders.paymentMethod = COD and COD_PENDING', undefined),
    countMetric('cancelled', 'Cancelled orders', cancelled.length, 'VERIFIED', 'orders.status = CANCELLED', undefined),
  ];

  if (contributionMarginPercent !== null) {
    metrics.push(
      countMetric(
        'contributionMarginPercent',
        'Contribution margin',
        contributionMarginPercent,
        basis,
        'contribution ÷ net revenue',
        'Percentage of net revenue kept after variable costs.'
      )
    );
  }

  return {
    windowDays,
    paidOrderCount: realised.length,
    committedCodOrderCount: codCommitted.length,
    cancelledOrderCount: cancelled.length,
    grossPaidRevenuePaise,
    refundedPaise,
    netRevenuePaise,
    discountPaise,
    supplierCostPaise,
    shippingCostPaise,
    paymentFeePaise,
    otherCostPaise,
    contributionPaise,
    contributionMarginPercent,
    averageOrderValuePaise,
    costCoverage,
    ordersWithCosts,
    basis,
    caveats,
    metrics,
  };
}
