import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { TableWrap, Th, Td, Pagination } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { SupplierOrderActions } from '@/components/admin/supplier-order-actions';
import type { SupplierOrderStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Supplier orders — Admin', robots: { index: false } };

const PER_PAGE = 25;
const STATUSES: SupplierOrderStatus[] = [
  'QUEUED',
  'SENT',
  'ACCEPTED',
  'REJECTED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'FAILED',
  'RETURN_REQUESTED',
];

const toneFor = (s: SupplierOrderStatus) =>
  s === 'FAILED' || s === 'REJECTED'
    ? 'red'
    : s === 'DELIVERED'
      ? 'green'
      : s === 'SHIPPED' || s === 'PROCESSING'
        ? 'blue'
        : s === 'CANCELLED'
          ? 'gray'
          : 'amber';

export default async function AdminSupplierOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; supplier?: string; focus?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const where = {
    ...(sp.status && STATUSES.includes(sp.status as SupplierOrderStatus)
      ? { status: sp.status as SupplierOrderStatus }
      : {}),
    ...(sp.supplier ? { supplierId: sp.supplier } : {}),
  };

  const [rows, total, suppliers, focus] = await Promise.all([
    prisma.supplierOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        supplier: { select: { name: true, type: true } },
        order: { select: { id: true, orderNumber: true, status: true } },
      },
    }),
    prisma.supplierOrder.count({ where }),
    prisma.supplier.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    sp.focus
      ? prisma.supplierOrder.findUnique({
          where: { id: sp.focus },
          include: {
            supplier: { select: { name: true, type: true } },
            order: { select: { id: true, orderNumber: true, status: true } },
          },
        })
      : Promise.resolve(null),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const allRows = focus && !rows.some((r) => r.id === focus.id) ? [focus, ...rows] : rows;

  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d);

  return (
    <div className="space-y-5">
      <header>
        <h1>Supplier orders</h1>
        <p className="mt-1 text-sm tabular-nums text-gray-500">
          {total} fulfilment record{total === 1 ? '' : 's'} — one per automated/manual supplier leg
          of an order.
        </p>
      </header>

      <form
        className="flex flex-wrap items-center gap-2"
        method="get"
        action="/admin/supplier-orders"
      >
        <select
          name="status"
          defaultValue={sp.status ?? ''}
          className="input-base w-auto"
          aria-label="Filter by status"
        >
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <select
          name="supplier"
          defaultValue={sp.supplier ?? ''}
          className="input-base w-auto"
          aria-label="Filter by supplier"
        >
          <option value="">All suppliers</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Filter
        </button>
        {(sp.status || sp.supplier) && (
          <Link href="/admin/supplier-orders" className="text-sm text-brand-700 hover:underline">
            Clear
          </Link>
        )}
      </form>

      <TableWrap>
        <table className="table-base">
          <thead className="bg-gray-50">
            <tr>
              <Th>Store order</Th>
              <Th className="hidden md:table-cell">Supplier</Th>
              <Th>Status</Th>
              <Th className="hidden lg:table-cell">External ID</Th>
              <Th className="hidden lg:table-cell">Tracking</Th>
              <Th className="hidden sm:table-cell">Attempts</Th>
              <Th className="hidden md:table-cell">Updated</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {allRows.length === 0 && (
              <tr>
                <Td className="py-8 text-center text-gray-400">No supplier orders yet.</Td>
              </tr>
            )}
            {allRows.map((so) => (
              <tr
                key={so.id}
                className={so.status === 'FAILED' ? 'bg-red-50/40' : 'hover:bg-gray-50/60'}
              >
                <Td>
                  <Link
                    href={`/admin/orders/${so.order.id}`}
                    className="font-mono text-xs font-semibold text-gray-900 hover:text-brand-700"
                  >
                    {so.order.orderNumber}
                  </Link>
                </Td>
                <Td className="hidden text-xs text-gray-600 md:table-cell">
                  {so.supplier.name}{' '}
                  <Badge tone={so.supplier.type === 'DEMO' ? 'purple' : 'neutral'}>
                    {so.supplier.type}
                  </Badge>
                </Td>
                <Td>
                  <Badge tone={toneFor(so.status) as 'red' | 'green' | 'blue' | 'gray' | 'amber'}>
                    {so.status.replace(/_/g, ' ')}
                  </Badge>
                  {so.lastError && (
                    <span
                      className="mt-0.5 block max-w-[220px] truncate text-[10px] text-red-500"
                      title={so.lastError}
                    >
                      {so.lastError}
                    </span>
                  )}
                </Td>
                <Td className="hidden max-w-[130px] truncate font-mono text-[11px] text-gray-500 lg:table-cell">
                  {so.supplierOrderId ?? '—'}
                </Td>
                <Td className="hidden text-[11px] text-gray-500 lg:table-cell">
                  {so.trackingNumber ? `${so.carrier ?? ''} ${so.trackingNumber}` : '—'}
                </Td>
                <Td className="hidden text-xs tabular-nums text-gray-500 sm:table-cell">
                  {so.attempts}
                </Td>
                <Td className="hidden text-[11px] text-gray-400 md:table-cell">
                  {fmt(so.updatedAt)}
                </Td>
                <Td>
                  <SupplierOrderActions supplierOrderId={so.id} status={so.status} />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      <Pagination
        page={page}
        totalPages={totalPages}
        basePath="/admin/supplier-orders"
        searchParams={{ status: sp.status, supplier: sp.supplier }}
      />
    </div>
  );
}
