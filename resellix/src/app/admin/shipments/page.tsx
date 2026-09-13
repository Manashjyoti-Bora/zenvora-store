import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { TableWrap, Th, Td, Pagination } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/feedback';
import type { ShipmentStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Shipments — Admin', robots: { index: false } };

const PER_PAGE = 25;

export default async function AdminShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const where = {
    ...(sp.status ? { status: sp.status as ShipmentStatus } : {}),
    ...(sp.q?.trim()
      ? {
          OR: [
            { trackingNumber: { contains: sp.q.trim(), mode: 'insensitive' as const } },
            { carrier: { contains: sp.q.trim(), mode: 'insensitive' as const } },
            { order: { orderNumber: { contains: sp.q.trim(), mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };

  const [shipments, total] = await Promise.all([
    prisma.shipment.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: { order: { select: { id: true, orderNumber: true } } },
    }),
    prisma.shipment.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const fmt = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d)
      : '—';
  const tone = (s: ShipmentStatus) =>
    s === 'DELIVERED' ? 'green' : s === 'EXCEPTION' || s === 'RETURNED' ? 'red' : 'blue';

  return (
    <div className="space-y-5">
      <header>
        <h1>Shipments</h1>
        <p className="mt-1 text-sm tabular-nums text-gray-500">
          {total} shipment{total === 1 ? '' : 's'} · tracking updates also arrive automatically from
          supplier webhooks when configured
        </p>
      </header>

      <Alert tone="info">
        Record new shipments or status updates from the order page (<em>Record shipment update</em>)
        — that flow validates the order state and notifies the customer.
      </Alert>

      <form
        className="flex flex-wrap items-center gap-2"
        method="get"
        action="/admin/shipments"
        role="search"
      >
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ''}
          placeholder="Tracking # / carrier / order #…"
          className="input-base w-full max-w-xs"
          aria-label="Search shipments"
        />
        <select
          name="status"
          defaultValue={sp.status ?? ''}
          className="input-base w-auto"
          aria-label="Filter by shipment status"
        >
          <option value="">Any status</option>
          {['PENDING', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION', 'RETURNED'].map(
            (s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            )
          )}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Filter
        </button>
        {(sp.q || sp.status) && (
          <Link href="/admin/shipments" className="text-sm text-brand-700 hover:underline">
            Clear
          </Link>
        )}
      </form>

      <TableWrap>
        <table className="table-base">
          <thead className="bg-gray-50">
            <tr>
              <Th>Order</Th>
              <Th>Carrier</Th>
              <Th>Tracking #</Th>
              <Th>Status</Th>
              <Th className="hidden md:table-cell">Shipped</Th>
              <Th className="hidden md:table-cell">Delivered</Th>
              <Th className="hidden lg:table-cell">Updated</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {shipments.length === 0 && (
              <tr>
                <Td className="py-8 text-center text-gray-400">No shipments recorded yet.</Td>
              </tr>
            )}
            {shipments.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50/60">
                <Td>
                  <Link
                    href={`/admin/orders/${s.order.id}`}
                    className="font-mono text-xs font-semibold text-gray-900 hover:text-brand-700"
                  >
                    {s.order.orderNumber}
                  </Link>
                </Td>
                <Td className="text-xs text-gray-600">{s.carrier ?? '—'}</Td>
                <Td className="font-mono text-[11px] text-gray-600">
                  {s.trackingNumber ?? '—'}
                  {s.trackingUrl && (
                    <a
                      href={s.trackingUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="ml-1 text-brand-700 hover:underline"
                    >
                      ↗
                    </a>
                  )}
                </Td>
                <Td>
                  <Badge tone={tone(s.status) as 'green' | 'red' | 'blue'}>
                    {s.status.replace(/_/g, ' ')}
                  </Badge>
                </Td>
                <Td className="hidden text-[11px] text-gray-500 md:table-cell">
                  {fmt(s.shippedAt)}
                </Td>
                <Td className="hidden text-[11px] text-gray-500 md:table-cell">
                  {fmt(s.deliveredAt)}
                </Td>
                <Td className="hidden text-[11px] text-gray-400 lg:table-cell">
                  {fmt(s.updatedAt)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      <Pagination
        page={page}
        totalPages={totalPages}
        basePath="/admin/shipments"
        searchParams={{ q: sp.q, status: sp.status }}
      />
    </div>
  );
}
