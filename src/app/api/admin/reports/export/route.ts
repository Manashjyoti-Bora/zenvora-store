import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { handleApiError } from '@/lib/errors';
import { auditLog } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { toPaise } from '@/lib/money';
import {
  parseRange,
  computeFinancialTotals,
  dailySeries,
  topProducts,
  NON_CONFIRMED_STATUSES,
} from '@/lib/admin/reports';

export const dynamic = 'force-dynamic';

function csvEscape(v: string | number | null): string {
  if (v === null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  return [headers.map(csvEscape).join(','), ...rows.map((r) => r.map(csvEscape).join(','))].join(
    '\n'
  );
}

function csvResponse(filename: string, body: string) {
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * GET /api/admin/reports/export?type=daily|financials|products|customers[&days=N|from&to]
 * CSV downloads for the admin analytics screen. Admin-only; audit-logged.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    return await buildExport(req);
  } catch (err) {
    return handleApiError(err, req);
  }
}

async function buildExport(req: Request): Promise<Response> {
    const user = await requireAdmin();
    const url = new URL(req.url);
    const type = url.searchParams.get('type') ?? 'daily';
    const range = parseRange({
      days: url.searchParams.get('days') ?? undefined,
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
    });
    const stamp = `${range.from.toISOString().slice(0, 10)}_${range.to.toISOString().slice(0, 10)}`;

    let filename = 'report.csv';
    let csv = '';

    if (type === 'daily') {
      const series = await dailySeries(range);
      filename = `resellix-daily-${stamp}.csv`;
      csv = toCsv(
        ['date', 'orders', 'revenue_inr', 'actual_profit_inr'],
        series.map((d) => [
          d.date,
          d.orders,
          (d.revenuePaise / 100).toFixed(2),
          (d.profitPaise / 100).toFixed(2),
        ])
      );
    } else if (type === 'financials') {
      const t = await computeFinancialTotals(range);
      filename = `resellix-financials-${stamp}.csv`;
      csv = toCsv(
        ['metric', 'value_inr', 'note'],
        [
          ['orders', t.orderCount, 'confirmed orders only'],
          ['revenue', (t.revenuePaise / 100).toFixed(2), 'gross order value'],
          ['refunds', (t.refundsPaise / 100).toFixed(2), ''],
          ['net_revenue', (t.netRevenuePaise / 100).toFixed(2), 'revenue minus refunds'],
          ['supplier_cost', (t.supplierCostPaise / 100).toFixed(2), ''],
          ['shipping_cost', (t.shippingCostPaise / 100).toFixed(2), ''],
          ['payment_fees', (t.paymentFeePaise / 100).toFixed(2), ''],
          ['cod_fees_collected', (t.codFeeCollectedPaise / 100).toFixed(2), 'income'],
          ['other_costs', (t.otherCostPaise / 100).toFixed(2), ''],
          ['total_costs', (t.totalCostsPaise / 100).toFixed(2), ''],
          ['discounts', (t.discountsPaise / 100).toFixed(2), 'already deducted from revenue'],
          [
            'gross_margin',
            (t.grossMarginPaise / 100).toFixed(2),
            'revenue minus supplier cost ONLY - NOT profit',
          ],
          ['actual_profit', (t.actualProfitPaise / 100).toFixed(2), 'finance-engine ledger'],
          ['unfinalized_orders', t.unfinalizedOrders, 'profit still an estimate for these'],
          ['aov', (t.aovPaise / 100).toFixed(2), ''],
        ]
      );
    } else if (type === 'products') {
      const rows = await topProducts(range, 500);
      const items = await prisma.orderItem.groupBy({
        by: ['productId'],
        where: {
          createdAt: { gte: range.from, lte: range.to },
          order: { status: { notIn: NON_CONFIRMED_STATUSES } },
        },
        _sum: { lineTotal: true, lineSupplierCost: true },
      });
      const costBy = new Map(
        items.map((i) => [i.productId, toPaise(i._sum?.lineSupplierCost ?? 0)])
      );
      filename = `resellix-products-${stamp}.csv`;
      csv = toCsv(
        ['product', 'units', 'revenue_inr', 'supplier_cost_inr', 'gross_margin_inr'],
        rows.map((r) => {
          const cost = costBy.get(r.productId) ?? 0;
          return [
            r.name,
            r.units,
            (r.revenuePaise / 100).toFixed(2),
            (cost / 100).toFixed(2),
            ((r.revenuePaise - cost) / 100).toFixed(2),
          ];
        })
      );
    } else if (type === 'customers') {
      const orders = await prisma.order.findMany({
        where: {
          createdAt: { gte: range.from, lte: range.to },
          status: { notIn: NON_CONFIRMED_STATUSES },
        },
        select: {
          guestEmail: true,
          guestName: true,
          grandTotal: true,
          actualProfit: true,
          user: { select: { email: true, name: true } },
        },
        take: 10_000,
      });
      const by = new Map<
        string,
        { name: string; orders: number; revenue: number; profit: number }
      >();
      for (const o of orders) {
        const key = (o.user?.email ?? o.guestEmail ?? 'unknown').toLowerCase();
        const cur = by.get(key) ?? {
          name: o.user?.name ?? o.guestName ?? '',
          orders: 0,
          revenue: 0,
          profit: 0,
        };
        cur.orders += 1;
        cur.revenue += toPaise(o.grandTotal);
        cur.profit += toPaise(o.actualProfit);
        by.set(key, cur);
      }
      filename = `resellix-customers-${stamp}.csv`;
      csv = toCsv(
        ['email', 'name', 'orders', 'revenue_inr', 'actual_profit_inr'],
        [...by.entries()]
          .sort((a, b) => b[1].revenue - a[1].revenue)
          .map(([email, v]) => [
            email,
            v.name,
            v.orders,
            (v.revenue / 100).toFixed(2),
            (v.profit / 100).toFixed(2),
          ])
      );
    } else {
      return csvResponse('resellix-report.csv', toCsv(['error'], [['unknown report type']]));
    }

    await auditLog({
      actor: { id: user.id, email: user.email },
      action: 'report.export',
      entityType: 'Report',
      entityId: type,
      data: { type, from: range.from.toISOString(), to: range.to.toISOString() },
      req,
    });
    return csvResponse(filename, csv);
}
