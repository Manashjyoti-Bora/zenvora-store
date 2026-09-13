import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { toPaise, formatINR } from '@/lib/money';
import { TableWrap, Th, Td, Pagination } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ReturnDecisionButton } from '@/components/admin/return-decision';
import type { ReturnStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Returns — Admin', robots: { index: false } };

const PER_PAGE = 25;

export default async function AdminReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const where = sp.status ? { status: sp.status as ReturnStatus } : {};

  const [returns, total] = await Promise.all([
    prisma.returnRequest.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        order: { select: { id: true, orderNumber: true, grandTotal: true, refundedTotal: true } },
        orderItem: { select: { id: true, lineTotal: true, productSnapshot: true } },
      },
    }),
    prisma.returnRequest.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  const tone = (s: ReturnStatus) =>
    s === 'APPROVED' || s === 'REFUNDED'
      ? 'green'
      : s === 'REJECTED' || s === 'CLOSED'
        ? 'gray'
        : 'amber';

  return (
    <div className="space-y-5">
      <header>
        <h1>Return requests</h1>
        <p className="mt-1 text-sm text-gray-500">
          Customer return/refund requests. Decisions trigger emails; approving issues the refund
          through the original payment provider (or queues it for manual settlement in TEST mode).
        </p>
      </header>

      <form className="flex flex-wrap items-center gap-2" method="get" action="/admin/returns">
        <select
          name="status"
          defaultValue={sp.status ?? ''}
          className="input-base w-auto"
          aria-label="Filter by return status"
        >
          <option value="">Any status</option>
          {['REQUESTED', 'APPROVED', 'REJECTED', 'RECEIVED', 'REFUNDED', 'CLOSED'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Filter
        </button>
        {sp.status && (
          <Link href="/admin/returns" className="text-sm text-brand-700 hover:underline">
            Clear
          </Link>
        )}
      </form>

      <TableWrap>
        <table className="table-base">
          <thead className="bg-gray-50">
            <tr>
              <Th>Order</Th>
              <Th className="hidden md:table-cell">Item</Th>
              <Th>Reason</Th>
              <Th className="hidden lg:table-cell">Requested</Th>
              <Th>Status</Th>
              <Th className="hidden md:table-cell">Refund</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {returns.length === 0 && (
              <tr>
                <Td className="py-8 text-center text-gray-400">No return requests.</Td>
              </tr>
            )}
            {returns.map((r) => {
              const snap = (r.orderItem?.productSnapshot ?? {}) as {
                name?: string;
                variantName?: string | null;
              };
              const maxRefundPaise = r.orderItem
                ? toPaise(r.orderItem.lineTotal)
                : toPaise(r.order.grandTotal) - toPaise(r.order.refundedTotal);
              return (
                <tr
                  key={r.id}
                  className={r.status === 'REQUESTED' ? 'bg-amber-50/30' : 'hover:bg-gray-50/60'}
                >
                  <Td>
                    <Link
                      href={`/admin/orders/${r.order.id}`}
                      className="font-mono text-xs font-semibold text-gray-900 hover:text-brand-700"
                    >
                      {r.order.orderNumber}
                    </Link>
                  </Td>
                  <Td className="hidden max-w-[180px] text-xs text-gray-600 md:table-cell">
                    {r.orderItem ? (
                      <>
                        <span className="block truncate font-medium">{snap.name ?? 'Item'}</span>
                        {snap.variantName && (
                          <span className="text-[10px] text-gray-400">{snap.variantName}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-gray-400">Whole order</span>
                    )}
                  </Td>
                  <Td className="max-w-[220px]">
                    <p className="truncate text-xs text-gray-700" title={r.reason}>
                      {r.reason}
                    </p>
                    {r.customerNote && (
                      <p className="truncate text-[10px] text-gray-400" title={r.customerNote}>
                        {r.customerNote}
                      </p>
                    )}
                  </Td>
                  <Td className="hidden text-[11px] text-gray-400 lg:table-cell">
                    {fmt(r.createdAt)}
                  </Td>
                  <Td>
                    <Badge tone={tone(r.status) as 'green' | 'gray' | 'amber'}>{r.status}</Badge>
                  </Td>
                  <Td className="hidden text-xs tabular-nums md:table-cell">
                    {r.refundAmount != null ? (
                      formatINR(toPaise(r.refundAmount))
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <ReturnDecisionButton
                      returnId={r.id}
                      status={r.status}
                      maxRefundRupees={Math.max(0, maxRefundPaise) / 100}
                    />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>

      <Pagination
        page={page}
        totalPages={totalPages}
        basePath="/admin/returns"
        searchParams={{ status: sp.status }}
      />
    </div>
  );
}
