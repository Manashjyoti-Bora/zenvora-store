import { prisma } from '../db';
import { toPaise } from '../money';
import { getSettings } from '../settings';
import { estimatePaymentFeePaise } from '../checkout/calc';
import type { Order, Prisma } from '@prisma/client';

/**
 * Order financial ledger.
 *
 * estimatedProfit (frozen at order creation): revenue - supplier costs -
 * estimated gateway fee.
 *
 * actualProfit is recomputed from booked order value, supplier/shipping/payment
 * costs, and refunds confirmed COMPLETED. REQUESTED/PROCESSING refunds are
 * obligations, not settled cash movements, and therefore never reduce realized
 * profit. Estimated and realized figures remain separate concepts.
 */

const dec = (paise: number) => (paise / 100).toFixed(2);

async function recalcWithClient(
  orderId: string,
  client: Prisma.TransactionClient,
  settings: Awaited<ReturnType<typeof getSettings>>
): Promise<Order> {
  const order = await client.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: true, payments: true, refunds: true },
  });

  const supplierCostTotal = order.items.reduce(
    (sum, item) => sum + toPaise(item.lineSupplierCost),
    0
  );
  const paidPayments = order.payments.filter((payment) =>
    ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(payment.status)
  );
  const actualFees = paidPayments
    .filter((payment) => !payment.feeIsEstimate)
    .reduce((sum, payment) => sum + toPaise(payment.feeAmount), 0);
  const estimatedFees = paidPayments
    .filter((payment) => payment.feeIsEstimate)
    .reduce((sum, payment) => sum + estimatePaymentFeePaise(toPaise(payment.amount), settings), 0);
  const hasEstimatedFees = paidPayments.some((payment) => payment.feeIsEstimate);
  const paymentFeeTotal = actualFees + estimatedFees;

  const refundedTotal = order.refunds
    .filter((refund) => refund.status === 'COMPLETED')
    .reduce((sum, refund) => sum + toPaise(refund.amount), 0);

  const revenue =
    toPaise(order.subtotal) -
    toPaise(order.discountTotal) +
    toPaise(order.shippingTotal) +
    toPaise(order.codFeeTotal);
  const actualProfit =
    revenue -
    supplierCostTotal -
    toPaise(order.shippingCostTotal) -
    paymentFeeTotal -
    toPaise(order.otherCostTotal) -
    refundedTotal;
  const financiallyFinal =
    ['DELIVERED', 'CANCELLED', 'REFUNDED', 'RETURNED'].includes(order.status) && !hasEstimatedFees;

  return client.order.update({
    where: { id: orderId },
    data: {
      supplierCostTotal: dec(supplierCostTotal),
      paymentFeeTotal: dec(paymentFeeTotal),
      refundedTotal: dec(refundedTotal),
      actualProfit: dec(actualProfit),
      ...(financiallyFinal ? { profitFinalizedAt: order.profitFinalizedAt ?? new Date() } : {}),
    },
  });
}

/**
 * Recalculate within the caller's transaction when supplied; otherwise use a
 * transaction of our own. This lets refund status, aggregates, order events,
 * and realized profit commit or roll back together.
 */
export async function recalcOrderFinancials(
  orderId: string,
  tx?: Prisma.TransactionClient
): Promise<Order> {
  const settings = await getSettings();
  if (tx) return recalcWithClient(orderId, tx, settings);
  return prisma.$transaction((client) => recalcWithClient(orderId, client, settings));
}

/** Admin adjustment of the manual cost buckets (shipping/other costs). */
export async function adjustOrderCosts(
  orderId: string,
  patch: { shippingCostPaise?: number; otherCostPaise?: number }
): Promise<Order> {
  const data: Record<string, string> = {};
  if (patch.shippingCostPaise !== undefined) data.shippingCostTotal = dec(patch.shippingCostPaise);
  if (patch.otherCostPaise !== undefined) data.otherCostTotal = dec(patch.otherCostPaise);
  if (Object.keys(data).length > 0) {
    await prisma.order.update({ where: { id: orderId }, data });
  }
  return recalcOrderFinancials(orderId);
}
