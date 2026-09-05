import { prisma } from '../db';
import { toPaise, sumPaise } from '../money';
import type { OrderStatus, Prisma } from '@prisma/client';

/**
 * Admin reporting queries.
 *
 * PROFIT HONESTY RULES (enforced here and labelled in the UI):
 * - "Gross margin" (revenue - supplier cost) is NEVER presented as profit.
 * - Actual profit uses the per-order ledger computed by the finance engine
 *   (supplier cost + supplier shipping + gateway fees + COD fees + other
 *   costs + refunds + discounts already netted in revenue) and is flagged
 *   when not yet finalised (e.g. supplier order still pending).
 */

export const NON_CONFIRMED_STATUSES: OrderStatus[] = [
  'PENDING_PAYMENT',
  'PAYMENT_FAILED',
  'CANCELLED',
];

export interface DateRange {
  from: Date;
  to: Date;
  days: number;
}

export function parseRange(sp: { from?: string; to?: string; days?: string }): DateRange {
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const parseDay = (v?: string): Date | null => {
    if (!v) return null;
    const d = new Date(`${v}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  let from = parseDay(sp.from);
  let to = parseDay(sp.to);
  if (to) to = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);

  if (!from && !to) {
    const days = Math.min(Math.max(parseInt(sp.days ?? '30', 10) || 30, 1), 365);
    from = new Date(endOfToday.getTime() - (days - 1) * 86_400_000);
    from = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    to = endOfToday;
  }
  if (!from) from = new Date((to ?? endOfToday).getTime() - 29 * 86_400_000);
  if (!to) to = endOfToday;
  if (from > to) [from, to] = [to, from];

  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
  return { from, to, days };
}

export interface FinancialTotals {
  orderCount: number;
  revenuePaise: number;
  refundsPaise: number;
  netRevenuePaise: number;
  supplierCostPaise: number;
  shippingCostPaise: number;
  paymentFeePaise: number;
  codFeeCollectedPaise: number;
  otherCostPaise: number;
  totalCostsPaise: number;
  discountsPaise: number;
  grossMarginPaise: number; // revenue - supplier costs ONLY (never call it profit)
  actualProfitPaise: number; // finance-engine ledger sum
  unfinalizedOrders: number; // actual profit still an estimate
  aovPaise: number;
}

const ORDER_FIN_SELECT = {
  id: true,
  status: true,
  grandTotal: true,
  subtotal: true,
  discountTotal: true,
  shippingTotal: true,
  codFeeTotal: true,
  refundedTotal: true,
  supplierCostTotal: true,
  shippingCostTotal: true,
  paymentFeeTotal: true,
  otherCostTotal: true,
  actualProfit: true,
  profitFinalizedAt: true,
  createdAt: true,
} satisfies Prisma.OrderSelect;

export async function computeFinancialTotals(range: DateRange): Promise<FinancialTotals> {
  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: range.from, lte: range.to },
      status: { notIn: NON_CONFIRMED_STATUSES },
    },
    select: ORDER_FIN_SELECT,
    take: 10_000,
  });

  const revenuePaise = sumPaise(orders.map((o) => toPaise(o.grandTotal)));
  const refundsPaise = sumPaise(orders.map((o) => toPaise(o.refundedTotal)));
  const supplierCostPaise = sumPaise(orders.map((o) => toPaise(o.supplierCostTotal)));
  const shippingCostPaise = sumPaise(orders.map((o) => toPaise(o.shippingCostTotal)));
  const paymentFeePaise = sumPaise(orders.map((o) => toPaise(o.paymentFeeTotal)));
  const codFeeCollectedPaise = sumPaise(orders.map((o) => toPaise(o.codFeeTotal)));
  const otherCostPaise = sumPaise(orders.map((o) => toPaise(o.otherCostTotal)));
  const discountsPaise = sumPaise(orders.map((o) => toPaise(o.discountTotal)));
  const actualProfitPaise = sumPaise(orders.map((o) => toPaise(o.actualProfit)));
  const unfinalizedOrders = orders.filter(
    (o) => !o.profitFinalizedAt && !['DELIVERED', 'REFUNDED', 'CANCELLED'].includes(o.status)
  ).length;

  const totalCostsPaise = supplierCostPaise + shippingCostPaise + paymentFeePaise + otherCostPaise;

  return {
    orderCount: orders.length,
    revenuePaise,
    refundsPaise,
    netRevenuePaise: revenuePaise - refundsPaise,
    supplierCostPaise,
    shippingCostPaise,
    paymentFeePaise,
    codFeeCollectedPaise,
    otherCostPaise,
    totalCostsPaise,
    discountsPaise,
    grossMarginPaise: revenuePaise - supplierCostPaise,
    actualProfitPaise,
    unfinalizedOrders,
    aovPaise: orders.length > 0 ? Math.round(revenuePaise / orders.length) : 0,
  };
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  label: string;
  orders: number;
  revenuePaise: number;
  profitPaise: number;
}

export async function dailySeries(range: DateRange): Promise<DailyPoint[]> {
  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: range.from, lte: range.to },
      status: { notIn: NON_CONFIRMED_STATUSES },
    },
    select: { createdAt: true, grandTotal: true, actualProfit: true },
    take: 10_000,
  });
  const map = new Map<string, DailyPoint>();
  const cursor = new Date(range.from);
  while (cursor <= range.to) {
    const key = cursor.toISOString().slice(0, 10);
    map.set(key, {
      date: key,
      label: new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(cursor),
      orders: 0,
      revenuePaise: 0,
      profitPaise: 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  for (const o of orders) {
    const key = o.createdAt.toISOString().slice(0, 10);
    const p = map.get(key);
    if (!p) continue;
    p.orders += 1;
    p.revenuePaise += toPaise(o.grandTotal);
    p.profitPaise += toPaise(o.actualProfit);
  }
  return [...map.values()];
}

export interface TopProductRow {
  productId: string | null;
  name: string;
  units: number;
  revenuePaise: number;
}

export async function topProducts(range: DateRange, limit = 6): Promise<TopProductRow[]> {
  const items = await prisma.orderItem.groupBy({
    by: ['productId'],
    where: {
      createdAt: { gte: range.from, lte: range.to },
      order: { status: { notIn: NON_CONFIRMED_STATUSES } },
    },
    _sum: { quantity: true, lineTotal: true },
    orderBy: { _sum: { lineTotal: 'desc' } },
    take: limit * 2,
  });
  const ids = items.map((i) => i.productId).filter((v): v is string => Boolean(v));
  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  const nameById = new Map(products.map((p) => [p.id, p.name]));
  return items
    .map((i) => ({
      productId: i.productId,
      name: i.productId ? (nameById.get(i.productId) ?? 'Deleted product') : 'Snapshot-only item',
      units: i._sum.quantity ?? 0,
      revenuePaise: toPaise(i._sum.lineTotal ?? 0),
    }))
    .slice(0, limit);
}

export interface DashboardAlert {
  tone: 'error' | 'warning' | 'info';
  label: string;
  count: number;
  href: string;
}

export async function dashboardAlerts(): Promise<DashboardAlert[]> {
  const dayAgo = new Date(Date.now() - 86_400_000);
  const [
    failedJobs,
    stuckJobs,
    failedPayments,
    failedSupplierOrders,
    lowStock,
    pendingReturns,
    pendingRefunds,
    unreadMessages,
    failedWebhooks,
  ] = await Promise.all([
    prisma.job.count({ where: { status: 'FAILED' } }),
    prisma.job.count({
      where: { status: 'PENDING', nextRunAt: { lt: new Date(Date.now() - 30 * 60_000) } },
    }),
    prisma.payment.count({ where: { status: 'FAILED', updatedAt: { gte: dayAgo } } }),
    prisma.supplierOrder.count({ where: { status: 'FAILED' } }),
    prisma.product.count({ where: { status: 'ACTIVE', stockMode: 'LOCAL', stock: { lte: 5 } } }),
    prisma.returnRequest.count({ where: { status: 'REQUESTED' } }),
    prisma.order.count({ where: { status: 'REFUND_PENDING' } }),
    prisma.contactMessage.count({ where: { status: 'NEW' } }),
    prisma.webhookEvent.count({
      where: {
        receivedAt: { gte: dayAgo },
        OR: [{ status: 'FAILED' }, { status: 'REJECTED' }, { status: 'RECEIVED' }],
      },
    }),
  ]);

  const alerts: DashboardAlert[] = [
    {
      tone: 'error',
      label: 'Failed background jobs (fulfilment/notifications)',
      count: failedJobs,
      href: '/admin/logs/jobs',
    },
    {
      tone: 'warning',
      label: 'Jobs overdue by >30 min (runner not executing?)',
      count: stuckJobs,
      href: '/admin/logs/jobs',
    },
    {
      tone: 'warning',
      label: 'Failed payments (last 24h)',
      count: failedPayments,
      href: '/admin/payments?status=FAILED',
    },
    {
      tone: 'error',
      label: 'Failed supplier orders (manual action needed)',
      count: failedSupplierOrders,
      href: '/admin/supplier-orders?status=FAILED',
    },
    {
      tone: 'warning',
      label: 'Low stock (≤5 units, local mode)',
      count: lowStock,
      href: '/admin/inventory',
    },
    {
      tone: 'info',
      label: 'Return requests awaiting decision',
      count: pendingReturns,
      href: '/admin/returns',
    },
    {
      tone: 'warning',
      label: 'Orders awaiting refund',
      count: pendingRefunds,
      href: '/admin/refunds',
    },
    {
      tone: 'info',
      label: 'New customer messages',
      count: unreadMessages,
      href: '/admin/messages',
    },
    {
      tone: 'error',
      label: 'Unprocessed webhook events (last 24h)',
      count: failedWebhooks,
      href: '/admin/logs/webhooks',
    },
  ];
  return alerts.filter((a) => a.count > 0);
}

export async function recentOrdersForAdmin(limit = 8) {
  return prisma.order.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      fulfilmentStatus: true,
      grandTotal: true,
      actualProfit: true,
      profitFinalizedAt: true,
      paymentMethod: true,
      createdAt: true,
    },
  });
}
