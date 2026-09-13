import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { toPaise, formatINR } from '@/lib/money';
import { TableWrap, Th, Td, Pagination } from '@/components/ui/table';
import { OrderStatusBadge, PaymentStatusBadge, FulfilmentStatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/feedback';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Orders — Admin', robots: { index: false } };

const PER_PAGE = 20;

const STATUSES = [
  'PENDING_PAYMENT',
  'PAYMENT_FAILED',
  'PAYMENT_VERIFIED',
  'ORDER_CONFIRMED',
  'SENT_TO_SUPPLIER',
  'SUPPLIER_ACCEPTED',
  'PROCESSING',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'REFUND_PENDING',
  'REFUNDED',
  'RETURN_REQUESTED',
  'RETURNED',
  'FULFILMENT_FAILED',
];

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    payment?: string;
    fulfilment?: string;
    method?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const where: Prisma.OrderWhereInput = {};
  if (sp.q?.trim()) {
    const term = sp.q.trim();
    where.OR = [
      { orderNumber: { contains: term, mode: 'insensitive' } },
      { guestEmail: { contains: term, mode: 'insensitive' } },
      { guestName: { contains: term, mode: 'insensitive' } },
      {
        user: {
          OR: [
            { email: { contains: term, mode: 'insensitive' } },
            { name: { contains: term, mode: 'insensitive' } },
          ],
        },
      },
    ];
  }
  if (sp.status && STATUSES.includes(sp.status))
    where.status = sp.status as Prisma.OrderWhereInput['status'];
  if (sp.payment) where.paymentStatus = sp.payment as Prisma.OrderWhereInput['paymentStatus'];
  if (sp.fulfilment)
    where.fulfilmentStatus = sp.fulfilment as Prisma.OrderWhereInput['fulfilmentStatus'];
  if (sp.method) where.paymentMethod = sp.method as Prisma.OrderWhereInput['paymentMethod'];

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
        fulfilmentStatus: true,
        paymentMethod: true,
        grandTotal: true,
        actualProfit: true,
        profitFinalizedAt: true,
        createdAt: true,
        guestName: true,
        guestEmail: true,
        user: { select: { name: true, email: true } },
        payments: { select: { provider: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="space-y-5">
      <header>
        <h1>Orders</h1>
        <p className="mt-1 text-sm tabular-nums text-gray-500">
          {total} order{total === 1 ? '' : 's'}
        </p>
      </header>

      <form
        className="flex flex-wrap items-center gap-2"
        method="get"
        action="/admin/orders"
        role="search"
      >
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ''}
          placeholder="Order # / customer / email…"
          className="input-base w-full max-w-xs"
          aria-label="Search orders"
        />
        <select
          name="status"
          defaultValue={sp.status ?? ''}
          className="input-base w-auto"
          aria-label="Order status"
        >
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <select
          name="payment"
          defaultValue={sp.payment ?? ''}
          className="input-base w-auto"
          aria-label="Payment status"
        >
          <option value="">Any payment</option>
          {['PENDING', 'COD_PENDING', 'PAID', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED'].map(
            (s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            )
          )}
        </select>
        <select
          name="fulfilment"
          defaultValue={sp.fulfilment ?? ''}
          className="input-base w-auto"
          aria-label="Fulfilment status"
        >
          <option value="">Any fulfilment</option>
          {[
            'PENDING',
            'SENT_TO_SUPPLIER',
            'SUPPLIER_ACCEPTED',
            'PROCESSING',
            'SHIPPED',
            'OUT_FOR_DELIVERY',
            'DELIVERED',
            'CANCELLED',
            'FAILED',
          ].map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <select
          name="method"
          defaultValue={sp.method ?? ''}
          className="input-base w-auto"
          aria-label="Payment method"
        >
          <option value="">Any method</option>
          <option value="PREPAID_GATEWAY">Online</option>
          <option value="COD">COD</option>
          <option value="TEST">TEST</option>
        </select>
        <button
          type="submit"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Filter
        </button>
        {(sp.q || sp.status || sp.payment || sp.fulfilment || sp.method) && (
          <Link href="/admin/orders" className="text-sm text-brand-700 hover:underline">
            Clear
          </Link>
        )}
      </form>

      {orders.length === 0 ? (
        <EmptyState
          icon="🧾"
          title="No orders match"
          description="Adjust the filters — new orders appear here the moment checkout succeeds."
        />
      ) : (
        <TableWrap>
          <table className="table-base">
            <thead className="bg-gray-50">
              <tr>
                <Th>Order</Th>
                <Th className="hidden md:table-cell">Customer</Th>
                <Th>Status</Th>
                <Th className="hidden lg:table-cell">Payment</Th>
                <Th className="hidden lg:table-cell">Fulfilment</Th>
                <Th>Total</Th>
                <Th className="hidden xl:table-cell">Profit</Th>
                <Th className="text-right">View</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-gray-50/60">
                  <Td>
                    <Link
                      href={`/admin/orders/${o.id}`}
                      className="font-mono text-xs font-semibold text-gray-900 hover:text-brand-700"
                    >
                      {o.orderNumber}
                    </Link>
                    <p className="text-[11px] text-gray-400">
                      {new Intl.DateTimeFormat('en-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(o.createdAt)}
                      {o.payments.some((p) => p.provider === 'TEST') && (
                        <span className="ml-1 font-bold text-amber-600">TEST</span>
                      )}
                    </p>
                  </Td>
                  <Td className="hidden max-w-[160px] md:table-cell">
                    <p className="truncate text-gray-700">
                      {o.user?.name ?? o.guestName ?? 'Guest'}
                    </p>
                    <p className="truncate text-[11px] text-gray-400">
                      {o.user?.email ?? o.guestEmail ?? ''}
                    </p>
                  </Td>
                  <Td>
                    <OrderStatusBadge status={o.status} />
                  </Td>
                  <Td className="hidden lg:table-cell">
                    <PaymentStatusBadge status={o.paymentStatus} />
                  </Td>
                  <Td className="hidden lg:table-cell">
                    <FulfilmentStatusBadge status={o.fulfilmentStatus} />
                  </Td>
                  <Td className="font-medium tabular-nums">{formatINR(toPaise(o.grandTotal))}</Td>
                  <Td className="hidden xl:table-cell">
                    <span
                      className={`tabular-nums ${toPaise(o.actualProfit) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}
                    >
                      {formatINR(toPaise(o.actualProfit))}
                    </span>
                    {!o.profitFinalizedAt &&
                      !['DELIVERED', 'REFUNDED', 'CANCELLED'].includes(o.status) && (
                        <span className="block text-[10px] text-gray-400">estimate</span>
                      )}
                  </Td>
                  <Td className="text-right">
                    <Link
                      href={`/admin/orders/${o.id}`}
                      className="text-xs font-medium text-brand-700 hover:underline"
                    >
                      Open →
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        basePath="/admin/orders"
        searchParams={{
          q: sp.q,
          status: sp.status,
          payment: sp.payment,
          fulfilment: sp.fulfilment,
          method: sp.method,
        }}
      />
    </div>
  );
}
