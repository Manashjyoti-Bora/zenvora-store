import type { Metadata } from 'next';
import Link from 'next/link';
import {
  parseRange,
  computeFinancialTotals,
  dailySeries,
  topProducts,
  dashboardAlerts,
  recentOrdersForAdmin,
} from '@/lib/admin/reports';
import { formatINR, toPaise } from '@/lib/money';
import { StatCard, Card, Alert, EmptyState } from '@/components/ui/feedback';
import { LineChart, BarChart } from '@/components/ui/charts';
import { OrderStatusBadge, PaymentStatusBadge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/button';
import { getSettings } from '@/lib/settings';
import { describePaymentProvider } from '@/lib/payments';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Admin dashboard', robots: { index: false } };

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const sp = await searchParams;
  const days = Math.min(Math.max(parseInt(sp.days ?? '30', 10) || 30, 1), 90);
  const range = parseRange({ days: String(days) });

  const [totals, series, top, alerts, recent, settings, payments] = await Promise.all([
    computeFinancialTotals(range),
    dailySeries(range),
    topProducts(range),
    dashboardAlerts(),
    recentOrdersForAdmin(8),
    getSettings(),
    Promise.resolve(describePaymentProvider()),
  ]);

  const profitTone =
    totals.actualProfitPaise > 0
      ? 'positive'
      : totals.actualProfitPaise < 0
        ? 'negative'
        : 'neutral';

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            Last {days} days (
            {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(range.from)} →{' '}
            {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(range.to)}) ·
            confirmed orders only
          </p>
        </div>
        <div className="flex gap-1.5" role="group" aria-label="Period">
          {[7, 30, 90].map((d) => (
            <Link
              key={d}
              href={`/admin?days=${d}`}
              aria-current={d === days ? 'true' : undefined}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                d === days
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
              }`}
            >
              {d}d
            </Link>
          ))}
          <Link
            href="/admin/analytics"
            className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-brand-700 ring-1 ring-gray-200 hover:bg-gray-50"
          >
            Full report →
          </Link>
        </div>
      </header>

      {settings.demoMode && (
        <Alert tone="warning" title="Demo mode is ON">
          Figures below come from demo catalog/test orders. Turn demo mode off in{' '}
          <Link href="/admin/settings" className="font-semibold underline">
            Settings
          </Link>{' '}
          after going live.
        </Alert>
      )}

      {payments.kind === 'NONE' && (
        <Alert tone="error" title="Payments are not configured">
          Online checkout cannot take payments until gateway credentials are added (see
          SETUP_CHECKLIST.md).{' '}
          {settings.shipping.codEnabled
            ? 'COD orders still work.'
            : 'COD is also disabled — no orders can be completed.'}
        </Alert>
      )}

      {/* Alerts needing action */}
      {alerts.length > 0 && (
        <Card title={`Needs attention (${alerts.length})`} padded={false}>
          <ul className="divide-y divide-gray-100">
            {alerts.map((a) => (
              <li key={a.label}>
                <Link
                  href={a.href}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-gray-50"
                >
                  <span className="flex items-center gap-2 text-gray-700">
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        a.tone === 'error'
                          ? 'bg-red-500'
                          : a.tone === 'warning'
                            ? 'bg-amber-500'
                            : 'bg-blue-500'
                      }`}
                    />
                    {a.label}
                  </span>
                  <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-bold tabular-nums text-gray-700">
                    {a.count}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* KPI grid */}
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Revenue (confirmed)"
          value={formatINR(totals.revenuePaise)}
          sub={`${totals.orderCount} orders · AOV ${formatINR(totals.aovPaise)}`}
        />
        <StatCard
          label="Refunds"
          value={`−${formatINR(totals.refundsPaise)}`}
          tone={totals.refundsPaise > 0 ? 'negative' : 'neutral'}
          sub={`Net revenue ${formatINR(totals.netRevenuePaise)}`}
        />
        <StatCard
          label="Total costs"
          value={formatINR(totals.totalCostsPaise)}
          sub="supplier + shipping + fees + other"
        />
        <StatCard
          label="Actual profit"
          value={formatINR(totals.actualProfitPaise)}
          tone={profitTone as 'positive' | 'negative' | 'neutral'}
          sub={
            totals.unfinalizedOrders > 0
              ? `⚠ ${totals.unfinalizedOrders} order(s) not finalised yet — estimates`
              : 'after all recorded costs & refunds'
          }
        />
      </dl>

      <Alert tone="info">
        <strong>Actual profit</strong> = net revenue − supplier cost − supplier shipping −
        gateway/COD fees − other recorded costs. It is not the same as gross margin (
        {formatINR(totals.grossMarginPaise)}), which excludes fees, shipping and refunds. Orders
        whose fulfilment is still open carry
        <em> estimated</em> profit until finalised.
      </Alert>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Revenue per day">
          <LineChart
            data={series.map((p) => ({ label: p.label, value: Math.round(p.revenuePaise / 100) }))}
            formatValue={(v) => `₹${v.toLocaleString('en-IN')}`}
          />
        </Card>
        <Card title="Actual profit per day">
          <LineChart
            data={series.map((p) => ({ label: p.label, value: Math.round(p.profitPaise / 100) }))}
            formatValue={(v) => `₹${v.toLocaleString('en-IN')}`}
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card
          title="Top products by revenue"
          action={
            <Link href="/admin/analytics" className="text-xs font-medium text-brand-700">
              Analytics →
            </Link>
          }
        >
          {top.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">No sales in this period yet.</p>
          ) : (
            <BarChart
              data={top.map((t) => ({
                label: t.name.length > 14 ? `${t.name.slice(0, 13)}…` : t.name,
                value: Math.round(t.revenuePaise / 100),
              }))}
              formatValue={(v) => `₹${v.toLocaleString('en-IN')}`}
            />
          )}
        </Card>

        <Card
          title="Recent orders"
          action={
            <Link href="/admin/orders" className="text-xs font-medium text-brand-700">
              All orders →
            </Link>
          }
          padded={false}
        >
          {recent.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon="🧾"
                title="No orders yet"
                description="Orders will appear here the moment customers check out."
              />
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {recent.map((o) => (
                <li key={o.id}>
                  <Link
                    href={`/admin/orders/${o.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-gray-50"
                  >
                    <span className="min-w-0">
                      <span className="font-mono text-xs font-semibold text-gray-900">
                        {o.orderNumber}
                      </span>
                      <span className="ml-2 text-xs text-gray-400">
                        {new Intl.DateTimeFormat('en-IN', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }).format(o.createdAt)}
                      </span>
                      <span className="mt-0.5 flex gap-1.5">
                        <OrderStatusBadge status={o.status} />
                        <PaymentStatusBadge status={o.paymentStatus} />
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-bold tabular-nums text-gray-900">
                        {formatINR(toPaise(o.grandTotal))}
                      </span>
                      <span
                        className={`block text-[11px] tabular-nums ${toPaise(o.actualProfit) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
                      >
                        profit {formatINR(toPaise(o.actualProfit))}
                        {!o.profitFinalizedAt &&
                        !['DELIVERED', 'REFUNDED', 'CANCELLED'].includes(o.status)
                          ? ' (est.)'
                          : ''}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Setup quick links for fresh installs */}
      {(payments.kind === 'NONE' || settings.demoMode || alerts.length === 0) && (
        <Card title="Setup & operations">
          <div className="flex flex-wrap gap-2 text-sm">
            <LinkButton href="/admin/products/new" variant="outline" size="sm">
              + Add product
            </LinkButton>
            <LinkButton href="/admin/products/import" variant="outline" size="sm">
              CSV import
            </LinkButton>
            <LinkButton href="/admin/suppliers" variant="outline" size="sm">
              Suppliers
            </LinkButton>
            <LinkButton href="/admin/settings" variant="outline" size="sm">
              Store settings
            </LinkButton>
            <LinkButton href="/admin/health" variant="outline" size="sm">
              System health
            </LinkButton>
          </div>
        </Card>
      )}
    </div>
  );
}
