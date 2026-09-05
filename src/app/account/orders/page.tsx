import type { Metadata } from 'next';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { toPaise, formatINR } from '@/lib/money';
import { OrderStatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/feedback';
import { LinkButton } from '@/components/ui/button';
import { Pagination } from '@/components/ui/table';
import type { OrderStatus, Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'My orders', robots: { index: false } };

const PER_PAGE = 10;

const FILTERS: Array<{ label: string; statuses: OrderStatus[] | null }> = [
  { label: 'All', statuses: null },
  {
    label: 'In progress',
    statuses: [
      'PENDING_PAYMENT',
      'PAYMENT_VERIFIED',
      'ORDER_CONFIRMED',
      'SENT_TO_SUPPLIER',
      'SUPPLIER_ACCEPTED',
      'PROCESSING',
      'SHIPPED',
      'OUT_FOR_DELIVERY',
    ],
  },
  { label: 'Delivered', statuses: ['DELIVERED'] },
  {
    label: 'Cancelled / returned',
    statuses: ['CANCELLED', 'REFUND_PENDING', 'REFUNDED', 'RETURN_REQUESTED', 'RETURNED'],
  },
  { label: 'Payment issues', statuses: ['PAYMENT_FAILED'] },
];

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; filter?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) return null;

  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const filterIdx = Math.max(
    0,
    FILTERS.findIndex(
      (f) =>
        f.label.toLowerCase().replace(/[^a-z]/g, '') ===
        (sp.filter ?? '').toLowerCase().replace(/[^a-z]/g, '')
    )
  );
  const filter = FILTERS[filterIdx] ?? FILTERS[0];

  const where: Prisma.OrderWhereInput = {
    userId: user.id,
    ...(filter.statuses ? { status: { in: filter.statuses } } : {}),
  };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        paymentStatus: true,
        grandTotal: true,
        createdAt: true,
        paymentMethod: true,
        _count: { select: { items: true } },
        items: { take: 1, select: { productSnapshot: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="space-y-5">
      <header>
        <h1>My orders</h1>
        <p className="mt-1 text-sm tabular-nums text-gray-500">
          {total} order{total === 1 ? '' : 's'}
        </p>
      </header>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter orders">
        {FILTERS.map((f, i) => (
          <Link
            key={f.label}
            role="tab"
            aria-selected={i === filterIdx}
            href={`/account/orders${i === 0 ? '' : `?filter=${encodeURIComponent(f.label.toLowerCase().replace(/ \/ /g, '-').replace(/ /g, '-'))}`}`}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              i === filterIdx
                ? 'bg-brand-600 text-white'
                : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {orders.length === 0 ? (
        <EmptyState
          icon="📦"
          title="No orders in this view"
          description="Try a different filter, or place your first order."
          action={<LinkButton href="/shop">Browse products</LinkButton>}
        />
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {orders.map((o) => {
            const snap = (o.items[0]?.productSnapshot ?? {}) as {
              name?: string;
              image?: string | null;
            };
            return (
              <li key={o.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/account/orders/${o.orderNumber}`}
                      className="text-sm font-semibold text-gray-900 hover:text-brand-700"
                    >
                      {o.orderNumber}
                    </Link>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {new Intl.DateTimeFormat('en-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(o.createdAt)}{' '}
                      · {o._count.items} item{o._count.items === 1 ? '' : 's'} ·{' '}
                      {o.paymentMethod === 'COD' ? 'Cash on Delivery' : 'Paid online'}
                    </p>
                    {snap.name && (
                      <p className="mt-1 line-clamp-1 text-xs text-gray-500">
                        {snap.name}
                        {o._count.items > 1 ? ` +${o._count.items - 1} more` : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <OrderStatusBadge status={o.status} />
                    <p className="text-sm font-bold tabular-nums text-gray-900">
                      {formatINR(toPaise(o.grandTotal))}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        basePath="/account/orders"
        searchParams={{ filter: sp.filter }}
      />
    </div>
  );
}
