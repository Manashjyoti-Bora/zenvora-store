import type { Metadata } from 'next';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { toPaise, formatINR } from '@/lib/money';
import { StatCard } from '@/components/ui/feedback';
import { OrderStatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/feedback';
import { LinkButton } from '@/components/ui/button';
import { BoxIcon } from '@/components/ui/icons';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'My account', robots: { index: false } };

export default async function AccountDashboard() {
  const user = await getCurrentUser();
  if (!user) return null; // layout redirects

  const [recentOrders, stats, defaultAddress] = await Promise.all([
    prisma.order.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        grandTotal: true,
        createdAt: true,
        _count: { select: { items: true } },
      },
    }),
    prisma.order.groupBy({
      by: ['status'],
      where: { userId: user.id },
      _count: { _all: true },
    }),
    prisma.address.findFirst({
      where: { userId: user.id, isDefaultShipping: true },
    }),
  ]);

  const total = stats.reduce((a, s) => a + s._count._all, 0);
  const active = stats
    .filter((s) => !['DELIVERED', 'CANCELLED', 'REFUNDED', 'RETURNED'].includes(s.status))
    .reduce((a, s) => a + s._count._all, 0);
  const delivered = stats.find((s) => s.status === 'DELIVERED')?._count._all ?? 0;

  return (
    <div className="space-y-6">
      <header>
        <h1>Hello, {user.name.split(' ')[0]}</h1>
        <p className="mt-1 text-sm text-ink-400">
          Manage your orders, addresses and account details.
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total orders" value={total} />
        <StatCard label="In progress" value={active} tone={active > 0 ? 'info' : 'neutral'} />
        <StatCard
          label="Delivered"
          value={delivered}
          tone={delivered > 0 ? 'positive' : 'neutral'}
        />
        <StatCard
          label="Default address"
          value={defaultAddress ? defaultAddress.city : '—'}
          sub={
            defaultAddress ? `${defaultAddress.state} — ${defaultAddress.postalCode}` : undefined
          }
        />
      </dl>

      <section aria-labelledby="recent-orders">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="recent-orders">Recent orders</h2>
          <Link
            href="/account/orders"
            className="text-sm font-medium text-brand-700 hover:text-brand-800"
          >
            View all →
          </Link>
        </div>
        {recentOrders.length === 0 ? (
          <EmptyState
            icon={<BoxIcon className="h-6 w-6" />}
            title="No orders yet"
            description="When you place your first order it will show up here with live tracking."
            action={<LinkButton href="/shop">Start shopping</LinkButton>}
          />
        ) : (
          <ul className="divide-y divide-ink-900/5 rounded-xl border border-ink-900/10 bg-white">
            {recentOrders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <Link
                    href={`/account/orders/${o.orderNumber}`}
                    className="text-sm font-semibold text-ink-900 hover:text-brand-700"
                  >
                    {o.orderNumber}
                  </Link>
                  <p className="text-xs text-ink-400">
                    {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(o.createdAt)}{' '}
                    · {o._count.items} item{o._count.items === 1 ? '' : 's'} ·{' '}
                    {formatINR(toPaise(o.grandTotal))}
                  </p>
                </div>
                <OrderStatusBadge status={o.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
