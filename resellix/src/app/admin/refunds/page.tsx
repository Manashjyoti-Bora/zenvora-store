import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { toPaise, formatINR } from '@/lib/money';
import { TableWrap, Th, Td, Pagination } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { RefundSettleButton } from '@/components/admin/refund-settle-button';
import type { RefundStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Refunds — Admin', robots: { index: false } };

const PER_PAGE = 25;

export default async function AdminRefundsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const where = sp.status ? { status: sp.status as RefundStatus } : {};

  const [refunds, total] = await Promise.all([
    prisma.refund.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        order: { select: { id: true, orderNumber: true } },
        returnRequest: { select: { id: true, reason: true } },
      },
    }),
    prisma.refund.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  const tone = (s: RefundStatus) =>
    s === 'COMPLETED' ? 'green' : s === 'FAILED' ? 'red' : 'amber';

  return (
    <div className="space-y-5">
      <header>
        <h1>Refunds</h1>
        <p className="mt-1 text-sm text-gray-500">
          All refund records. Gateway refunds are issued automatically via the provider API; TEST
          and manual refunds are settled here once money actually moves.
        </p>
      </header>

      <form className="flex flex-wrap items-center gap-2" method="get" action="/admin/refunds">
        <select
          name="status"
          defaultValue={sp.status ?? ''}
          className="input-base w-auto"
          aria-label="Filter by refund status"
        >
          <option value="">Any status</option>
          {['REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED'].map((s) => (
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
          <Link href="/admin/refunds" className="text-sm text-brand-700 hover:underline">
            Clear
          </Link>
        )}
      </form>

      <TableWrap>
        <table className="table-base">
          <thead className="bg-gray-50">
            <tr>
              <Th>Order</Th>
              <Th>Amount</Th>
              <Th className="hidden md:table-cell">Reason</Th>
              <Th className="hidden lg:table-cell">Provider refund</Th>
              <Th>Status</Th>
              <Th className="hidden md:table-cell">Initiated</Th>
              <Th className="hidden md:table-cell">When</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {refunds.length === 0 && (
              <tr>
                <Td className="py-8 text-center text-gray-400">No refunds recorded.</Td>
              </tr>
            )}
            {refunds.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50/60">
                <Td>
                  <Link
                    href={`/admin/orders/${r.order.id}`}
                    className="font-mono text-xs font-semibold text-gray-900 hover:text-brand-700"
                  >
                    {r.order.orderNumber}
                  </Link>
                  {r.returnRequest && (
                    <span className="block text-[10px] text-gray-400">from return request</span>
                  )}
                </Td>
                <Td className="font-medium tabular-nums">{formatINR(toPaise(r.amount))}</Td>
                <Td className="hidden max-w-[200px] truncate text-xs text-gray-500 md:table-cell">
                  {r.reason ?? '—'}
                </Td>
                <Td className="hidden max-w-[140px] truncate font-mono text-[11px] text-gray-500 lg:table-cell">
                  {r.providerRefundId ?? '—'}
                  {r.provider && (
                    <span className="block text-[10px] text-gray-400">{r.provider}</span>
                  )}
                </Td>
                <Td>
                  <Badge tone={tone(r.status) as 'green' | 'red' | 'amber'}>{r.status}</Badge>
                  {r.failureReason && (
                    <span
                      className="mt-0.5 block max-w-[160px] truncate text-[10px] text-red-500"
                      title={r.failureReason}
                    >
                      {r.failureReason}
                    </span>
                  )}
                </Td>
                <Td className="hidden text-xs text-gray-500 md:table-cell">
                  {r.initiatedBy.toLowerCase()}
                </Td>
                <Td className="hidden text-[11px] text-gray-400 md:table-cell">
                  {fmt(r.createdAt)}
                </Td>
                <Td className="text-right">
                  {['REQUESTED', 'PROCESSING', 'FAILED'].includes(r.status) && (
                    <RefundSettleButton refundId={r.id} />
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      <Pagination
        page={page}
        totalPages={totalPages}
        basePath="/admin/refunds"
        searchParams={{ status: sp.status }}
      />
    </div>
  );
}
