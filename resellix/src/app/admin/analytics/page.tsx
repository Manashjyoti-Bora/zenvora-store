import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { toPaise, formatINR } from '@/lib/money';
import {
  parseRange,
  computeFinancialTotals,
  dailySeries,
  topProducts,
  NON_CONFIRMED_STATUSES,
} from '@/lib/admin/reports';
import { StatCard, Card, Alert } from '@/components/ui/feedback';
import { LineChart, BarChart } from '@/components/ui/charts';
import { TableWrap, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Analytics — Admin', robots: { index: false } };

const inr = (paise: number) => formatINR(paise);

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const range = parseRange(sp);

  const [
    totals,
    series,
    top,
    statusGroups,
    topCustomerOrders,
    couponUsage,
    refundStats,
    returnStats,
  ] = await Promise.all([
    computeFinancialTotals(range),
    dailySeries(range),
    topProducts(range, 8),
    prisma.order.groupBy({
      by: ['status'],
      where: { createdAt: { gte: range.from, lte: range.to } },
      _count: { _all: true },
    }),
    prisma.order.findMany({
      where: {
        createdAt: { gte: range.from, lte: range.to },
        status: { notIn: NON_CONFIRMED_STATUSES },
      },
      select: {
        guestEmail: true,
        grandTotal: true,
        actualProfit: true,
        user: { select: { email: true } },
      },
      take: 10_000,
    }),
    prisma.order.groupBy({
      by: ['couponCode'],
      where: {
        createdAt: { gte: range.from, lte: range.to },
        couponCode: { not: null },
        status: { notIn: NON_CONFIRMED_STATUSES },
      },
      _count: { _all: true },
      _sum: { discountTotal: true },
      orderBy: { _count: { couponCode: 'desc' } },
      take: 6,
    }),
    prisma.refund.aggregate({
      where: { createdAt: { gte: range.from, lte: range.to } },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.returnRequest.groupBy({
      by: ['status'],
      where: { createdAt: { gte: range.from, lte: range.to } },
      _count: { _all: true },
    }),
  ]);

  const customersBy = new Map<
    string,
    { orders: number; revenuePaise: number; profitPaise: number }
  >();
  for (const o of topCustomerOrders) {
    const key = (o.user?.email ?? o.guestEmail ?? 'unknown').toLowerCase();
    const cur = customersBy.get(key) ?? { orders: 0, revenuePaise: 0, profitPaise: 0 };
    cur.orders += 1;
    cur.revenuePaise += toPaise(o.grandTotal);
    cur.profitPaise += toPaise(o.actualProfit);
    customersBy.set(key, cur);
  }
  const topCustomers = [...customersBy.entries()]
    .sort((a, b) => b[1].revenuePaise - a[1].revenuePaise)
    .slice(0, 6);

  const exportUrl = (type: string) =>
    `/api/admin/reports/export?type=${type}&from=${range.from.toISOString().slice(0, 10)}&to=${range.to.toISOString().slice(0, 10)}`;

  const profitPositive = totals.actualProfitPaise >= 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Analytics</h1>
          <p className="mt-1 text-sm text-gray-500">
            {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(range.from)} →{' '}
            {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(range.to)} · confirmed
            orders only (pending / failed / cancelled excluded)
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[7, 30, 90].map((d) => (
            <Link
              key={d}
              href={`/admin/analytics?days=${d}`}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                !sp.from && Number(sp.days ?? 30) === d
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
              }`}
            >
              Last {d} days
            </Link>
          ))}
          <form method="get" action="/admin/analytics" className="flex items-center gap-1.5">
            <input
              type="date"
              name="from"
              defaultValue={sp.from ?? ''}
              className="input-base w-auto py-1 text-xs"
              aria-label="From date"
            />
            <input
              type="date"
              name="to"
              defaultValue={sp.to ?? ''}
              className="input-base w-auto py-1 text-xs"
              aria-label="To date"
            />
            <button
              type="submit"
              className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
            >
              Apply
            </button>
          </form>
        </div>
      </header>

      {totals.unfinalizedOrders > 0 && (
        <Alert tone="warning">
          {totals.unfinalizedOrders} order{totals.unfinalizedOrders === 1 ? '' : 's'} in this period
          still ha{totals.unfinalizedOrders === 1 ? 's' : 've'} estimated profit (not delivered /
          refund not finalised). Actual profit below includes those estimates — treat the figure as
          &ldquo;actual profit (incl. est.)&rdquo;.
        </Alert>
      )}

      <section aria-label="Financial totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Revenue (gross)"
          value={inr(totals.revenuePaise)}
          sub={`${totals.orderCount} confirmed orders · AOV ${inr(totals.aovPaise)}`}
        />
        <StatCard
          label="Refunds"
          value={inr(totals.refundsPaise)}
          sub={`net revenue ${inr(totals.netRevenuePaise)}`}
          tone={totals.refundsPaise > 0 ? 'negative' : 'neutral'}
        />
        <StatCard
          label="Gross margin"
          value={inr(totals.grossMarginPaise)}
          sub="revenue − supplier cost — NOT net profit"
          tone="info"
        />
        <StatCard
          label={`Actual profit${totals.unfinalizedOrders > 0 ? ' (incl. est.)' : ''}`}
          value={inr(totals.actualProfitPaise)}
          sub={
            totals.revenuePaise > 0
              ? `${((totals.actualProfitPaise / totals.revenuePaise) * 100).toFixed(1)}% of revenue`
              : 'no revenue yet'
          }
          tone={profitPositive ? 'positive' : 'negative'}
        />
      </section>

      <section aria-label="Cost breakdown">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Where the money went</h2>
        <Card className="p-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm lg:grid-cols-3">
            {[
              ['Supplier cost', totals.supplierCostPaise],
              ['Shipping cost (paid out)', totals.shippingCostPaise],
              ['Payment gateway fees', totals.paymentFeePaise],
              ['Other costs', totals.otherCostPaise],
              ['COD fees collected (income)', totals.codFeeCollectedPaise],
            ].map(([label, val]) => (
              <div
                key={label as string}
                className="flex justify-between gap-2 border-b border-dashed border-gray-100 pb-1"
              >
                <dt className="text-gray-500">{label}</dt>
                <dd className="font-medium tabular-nums">{inr(val as number)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-2 font-semibold">
              <dt>Total costs</dt>
              <dd className="tabular-nums">{inr(totals.totalCostsPaise)}</dd>
            </div>
            <div className="flex justify-between gap-2 text-gray-500">
              <dt>Discounts given (incl. in revenue)</dt>
              <dd className="tabular-nums">{inr(totals.discountsPaise)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-[11px] text-gray-400">
            Actual profit = net revenue − total costs + COD fee income, computed per-order by the
            finance engine at confirmation and finalised on delivery/refund.
          </p>
        </Card>
      </section>

      <section aria-label="Trends" className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Revenue by day</h2>
            <a
              href={exportUrl('daily')}
              className="text-xs font-medium text-brand-700 hover:underline"
              download
            >
              Export CSV
            </a>
          </div>
          <LineChart
            data={series.map((d) => ({ label: d.label, value: Math.round(d.revenuePaise / 100) }))}
            formatValue={(v) => `₹${Math.round(v)}`}
          />
        </Card>
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Actual profit by day (₹)</h2>
            <span className="text-[10px] text-gray-400">
              negative days = refunds/costs exceeded revenue
            </span>
          </div>
          <BarChart
            data={series.map((d) => ({ label: d.label, value: Math.round(d.profitPaise / 100) }))}
            formatValue={(v) => `₹${v}`}
          />
        </Card>
      </section>

      <section aria-label="Top products" className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Top products by revenue</h2>
            <a
              href={exportUrl('products')}
              className="text-xs font-medium text-brand-700 hover:underline"
              download
            >
              Export CSV
            </a>
          </div>
          <TableWrap className="rounded-none border-0">
            <table className="table-base">
              <tbody className="divide-y divide-gray-100">
                {top.length === 0 && (
                  <tr>
                    <Td className="py-6 text-center text-gray-400">No sales in this period.</Td>
                  </tr>
                )}
                {top.map((p, i) => (
                  <tr key={p.productId ?? i}>
                    <Td className="w-6 text-xs text-gray-400">{i + 1}</Td>
                    <Td className="text-xs font-medium text-gray-800">{p.name}</Td>
                    <Td className="text-xs tabular-nums text-gray-500">{p.units} sold</Td>
                    <Td className="text-right font-medium tabular-nums">{inr(p.revenuePaise)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>

        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Top customers</h2>
            <a
              href={exportUrl('customers')}
              className="text-xs font-medium text-brand-700 hover:underline"
              download
            >
              Export CSV
            </a>
          </div>
          <TableWrap className="rounded-none border-0">
            <table className="table-base">
              <tbody className="divide-y divide-gray-100">
                {topCustomers.length === 0 && (
                  <tr>
                    <Td className="py-6 text-center text-gray-400">No customers yet.</Td>
                  </tr>
                )}
                {topCustomers.map(([email, v]) => (
                  <tr key={email}>
                    <Td className="text-xs">
                      <span className="font-medium text-gray-800">{email}</span>
                      <span className="ml-2 text-gray-400">{v.orders} orders</span>
                    </Td>
                    <Td className="text-right text-xs tabular-nums">
                      <span className="font-medium">{inr(v.revenuePaise)}</span>
                      <span className="ml-2 text-gray-400">profit {inr(v.profitPaise)}</span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      </section>

      <section aria-label="Operations" className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Order status mix (period)</h2>
          <ul className="space-y-1.5">
            {statusGroups.map((g) => (
              <li key={g.status} className="flex items-center justify-between gap-2 text-xs">
                <Badge
                  tone={['CANCELLED', 'PAYMENT_FAILED'].includes(g.status) ? 'red' : 'neutral'}
                >
                  {g.status.replace(/_/g, ' ')}
                </Badge>
                <span className="tabular-nums text-gray-600">{g._count._all}</span>
              </li>
            ))}
            {statusGroups.length === 0 && (
              <li className="text-xs text-gray-400">No orders in this period.</li>
            )}
          </ul>
          <a
            href={exportUrl('financials')}
            className="mt-3 block text-xs font-medium text-brand-700 hover:underline"
            download
          >
            Export financial summary CSV
          </a>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Coupon usage (period)</h2>
          {couponUsage.length === 0 ? (
            <p className="text-xs text-gray-400">No coupon orders in this period.</p>
          ) : (
            <ul className="space-y-1.5">
              {couponUsage.map((c) => (
                <li
                  key={c.couponCode ?? ''}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="font-mono font-medium text-gray-800">{c.couponCode}</span>
                  <span className="tabular-nums text-gray-500">
                    {c._count._all}× · {inr(toPaise(c._sum.discountTotal ?? 0))} off
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">
            Refunds &amp; returns (period)
          </h2>
          <p className="text-sm tabular-nums">
            <span className="font-semibold text-gray-900">{refundStats._count._all ?? 0}</span>
            <span className="text-gray-500"> refunds · </span>
            <span className="font-semibold text-gray-900">
              {inr(toPaise(refundStats._sum.amount ?? 0))}
            </span>
            <span className="text-gray-500"> total refunded</span>
          </p>
          <ul className="mt-2 space-y-1.5">
            {returnStats.map((r) => (
              <li key={r.status} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-gray-600">{r.status.toLowerCase()} returns</span>
                <span className="font-medium tabular-nums">{r._count._all}</span>
              </li>
            ))}
            {returnStats.length === 0 && (
              <li className="text-xs text-gray-400">No return requests.</li>
            )}
          </ul>
        </Card>
      </section>
    </div>
  );
}
