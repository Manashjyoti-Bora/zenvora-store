import { prisma } from '../db';
import { toPaise } from '../money';
import { getSettings } from '../settings';
import { estimatePaymentFeePaise } from '../checkout/calc';
import type { Order } from '@prisma/client';

/**
 * Order financial ledger.
 *
 * estimatedProfit (frozen at order creation):
 *   revenue - supplier costs - estimated gateway fee
 *
 * actualProfit (continuously recomputed as real data arrives):
 *   revenue
 *   - supplier cost total      (frozen snapshots on order items)
 *   - shipping cost total      (extra shipping we pay, admin-adjustable)
 *   - payment fee total        (actual gateway fees when known, else estimate)
 *   - other cost total         (admin-adjustable: packaging, platform fees...)
 *   - refunded total           (refunds issued)
 *
 * The UI must NEVER present estimatedProfit as guaranteed net profit - the
 * admin dashboard labels it "estimated" and shows the actual figure once
 * fees/refunds are known. profitFinalizedAt is set when the order reaches a
 * financial end-state (delivered/cancelled/refunded) and no estimated fees
 * remain.
 */

const dec = (paise: number) => (paise / 100).toFixed(2);

export async function recalcOrderFinancials(orderId: string): Promise<Order> {
  const settings = await getSettings();
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: true, payments: true, refunds: true },
  });

  const supplierCostTotal = order.items.reduce((a, i) => a + toPaise(i.lineSupplierCost), 0);

  const paidPayments = order.payments.filter((p) =>
    ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(p.status)
  );
  const paidAmount = paidPayments.reduce((a, p) => a + toPaise(p.amount), 0);
  const actualFees = paidPayments
    .filter((p) => !p.feeIsEstimate)
    .reduce((a, p) => a + toPaise(p.feeAmount), 0);
  const hasEstimatedFees = paidPayments.some((p) => p.feeIsEstimate);
  const estimatedFees = hasEstimatedFees
    ? paidPayments
        .filter((p) => p.feeIsEstimate)
        .reduce((a, p) => a + estimatePaymentFeePaise(toPaise(p.amount), settings), 0)
    : 0;
  const paymentFeeTotal = actualFees + estimatedFees;

  const refundedTotal = order.refunds
    .filter((r) => r.status === 'PROCESSING' || r.status === 'COMPLETED')
    .reduce((a, r) => a + toPaise(r.amount), 0);

  const shippingCostTotal = toPaise(order.shippingCostTotal);
  const otherCostTotal = toPaise(order.otherCostTotal);

  const revenue =
    toPaise(order.subtotal) -
    toPaise(order.discountTotal) +
    toPaise(order.shippingTotal) +
    toPaise(order.codFeeTotal);

  const actualProfit =
    revenue -
    supplierCostTotal -
    shippingCostTotal -
    paymentFeeTotal -
    otherCostTotal -
    refundedTotal;

  const financiallyFinal =
    ['DELIVERED', 'CANCELLED', 'REFUNDED', 'RETURNED'].includes(order.status) && !hasEstimatedFees;

  const codCollected = order.paymentStatus === 'COD_PENDING' ? 0 : paidAmount; // informational

  return prisma.order
    .update({
      where: { id: orderId },
      data: {
        supplierCostTotal: dec(supplierCostTotal),
        paymentFeeTotal: dec(paymentFeeTotal),
        refundedTotal: dec(refundedTotal),
        actualProfit: dec(actualProfit),
        ...(financiallyFinal ? { profitFinalizedAt: order.profitFinalizedAt ?? new Date() } : {}),
      },
    })
    .then((updated) => {
      void codCollected;
      void paidAmount;
      return updated;
    });
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
