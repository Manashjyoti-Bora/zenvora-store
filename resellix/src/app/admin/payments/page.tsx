import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { toPaise, formatINR } from '@/lib/money';
import { TableWrap, Th, Td, Pagination } from '@/components/ui/table';
import { Badge, GatewayPaymentStatusBadge } from '@/components/ui/badge';
import type { PaymentStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Payments — Admin', robots: { index: false } };

const PER_PAGE = 25;

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; provider?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const where = {
    ...(sp.status ? { status: sp.status as PaymentStatus } : {}),
    ...(sp.provider ? { provider: sp.provider as 'RAZORPAY' | 'TEST' } : {}),
  };

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: { order: { select: { id: true, orderNumber: true } } },
    }),
    prisma.payment.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d);

  return (
    <div className="space-y-5">
      <header>
        <h1>Payments</h1>
        <p className="mt-1 text-sm text-gray-500">
          Every gateway/TEST payment attempt with its verification state. Fees marked <em>est.</em>{' '}
          are settings-based estimates until the gateway reports the actual charge.
        </p>
      </header>

      <form className="flex flex-wrap items-center gap-2" method="get" action="/admin/payments">
        <select
          name="status"
          defaultValue={sp.status ?? ''}
          className="input-base w-auto"
          aria-label="Filter by payment status"
        >
          <option value="">Any status</option>
          {['CREATED', 'PAID', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED'].map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <select
          name="provider"
          defaultValue={sp.provider ?? ''}
          className="input-base w-auto"
          aria-label="Filter by provider"
        >
          <option value="">Any provider</option>
          <option value="RAZORPAY">Razorpay</option>
          <option value="TEST">TEST</option>
        </select>
        <button
          type="submit"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Filter
        </button>
        {(sp.status || sp.provider) && (
          <Link href="/admin/payments" className="text-sm text-brand-700 hover:underline">
            Clear
          </Link>
        )}
      </form>

      <TableWrap>
        <table className="table-base">
          <thead className="bg-gray-50">
            <tr>
              <Th>Order</Th>
              <Th>Provider</Th>
              <Th className="hidden md:table-cell">Provider order</Th>
              <Th className="hidden lg:table-cell">Payment ID</Th>
              <Th>Amount</Th>
              <Th>Fee</Th>
              <Th>Status</Th>
              <Th className="hidden md:table-cell">When</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {payments.length === 0 && (
              <tr>
                <Td className="py-8 text-center text-gray-400">No payment attempts recorded.</Td>
              </tr>
            )}
            {payments.map((p) => (
              <tr key={p.id} className="hover:bg-gray-50/60">
                <Td>
                  <Link
                    href={`/admin/orders/${p.order.id}`}
                    className="font-mono text-xs font-semibold text-gray-900 hover:text-brand-700"
                  >
                    {p.order.orderNumber}
                  </Link>
                </Td>
                <Td>
                  {p.provider}
                  {p.provider === 'TEST' && (
                    <Badge tone="amber" className="ml-1">
                      TEST
                    </Badge>
                  )}
                </Td>
                <Td className="hidden max-w-[150px] truncate font-mono text-[11px] text-gray-500 md:table-cell">
                  {p.providerOrderId ?? '—'}
                </Td>
                <Td className="hidden max-w-[150px] truncate font-mono text-[11px] text-gray-500 lg:table-cell">
                  {p.providerPaymentId ?? '—'}
                </Td>
                <Td className="font-medium tabular-nums">{formatINR(toPaise(p.amount))}</Td>
                <Td className="text-xs tabular-nums text-gray-500">
                  {formatINR(toPaise(p.feeAmount))}
                  {p.feeIsEstimate && <span className="block text-[10px] text-gray-400">est.</span>}
                </Td>
                <Td>
                  <GatewayPaymentStatusBadge status={p.status} />
                  {p.failureReason && (
                    <span
                      className="mt-0.5 block max-w-[180px] truncate text-[10px] text-red-500"
                      title={p.failureReason}
                    >
                      {p.failureReason}
                    </span>
                  )}
                </Td>
                <Td className="hidden text-[11px] text-gray-400 md:table-cell">
                  {fmt(p.createdAt)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      <Pagination
        page={page}
        totalPages={totalPages}
        basePath="/admin/payments"
        searchParams={{ status: sp.status, provider: sp.provider }}
      />
    </div>
  );
}
