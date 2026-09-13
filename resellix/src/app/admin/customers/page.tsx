import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { toPaise, formatINR } from '@/lib/money';
import { TableWrap, Th, Td, Pagination } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Customers — Admin', robots: { index: false } };

const PER_PAGE = 25;

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const where: Prisma.UserWhereInput = {
    role: 'CUSTOMER',
    ...(sp.q?.trim()
      ? {
          OR: [
            { email: { contains: sp.q.trim(), mode: 'insensitive' } },
            { name: { contains: sp.q.trim(), mode: 'insensitive' } },
            { phone: { contains: sp.q.trim(), mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true,
        orders: {
          select: { id: true, grandTotal: true, status: true },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="space-y-5">
      <header>
        <h1>Customers</h1>
        <p className="mt-1 text-sm tabular-nums text-gray-500">
          {total} registered customer{total === 1 ? '' : 's'} · guest checkouts are listed under
          Orders
        </p>
      </header>

      <form
        className="flex flex-wrap items-center gap-2"
        method="get"
        action="/admin/customers"
        role="search"
      >
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ''}
          placeholder="Search name / email / phone…"
          className="input-base w-full max-w-xs"
          aria-label="Search customers"
        />
        <button
          type="submit"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Search
        </button>
        {sp.q && (
          <Link href="/admin/customers" className="text-sm text-brand-700 hover:underline">
            Clear
          </Link>
        )}
      </form>

      <TableWrap>
        <table className="table-base">
          <thead className="bg-gray-50">
            <tr>
              <Th>Customer</Th>
              <Th className="hidden md:table-cell">Phone</Th>
              <Th>Orders</Th>
              <Th>Lifetime value</Th>
              <Th className="hidden lg:table-cell">Joined</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.length === 0 && (
              <tr>
                <Td className="py-8 text-center text-gray-400">No customers match.</Td>
              </tr>
            )}
            {users.map((u) => {
              const confirmed = u.orders.filter(
                (o) => !['PENDING_PAYMENT', 'PAYMENT_FAILED', 'CANCELLED'].includes(o.status)
              );
              const ltv = confirmed.reduce((a, o) => a + toPaise(o.grandTotal), 0);
              return (
                <tr key={u.id} className="hover:bg-gray-50/60">
                  <Td>
                    <p className="font-medium text-gray-900">{u.name}</p>
                    <p className="text-xs text-gray-400">{u.email}</p>
                  </Td>
                  <Td className="hidden text-xs text-gray-600 md:table-cell">{u.phone ?? '—'}</Td>
                  <Td className="tabular-nums">
                    <Link
                      href={`/admin/orders?q=${encodeURIComponent(u.email)}`}
                      className="text-brand-700 hover:underline"
                    >
                      {u.orders.length}
                    </Link>
                  </Td>
                  <Td className="font-medium tabular-nums">{formatINR(ltv)}</Td>
                  <Td className="hidden text-[11px] text-gray-400 lg:table-cell">
                    {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(u.createdAt)}
                  </Td>
                  <Td>
                    <Badge tone={u.status === 'ACTIVE' ? 'green' : 'red'}>{u.status}</Badge>
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
        basePath="/admin/customers"
        searchParams={{ q: sp.q }}
      />
      <p className="text-[11px] text-gray-400">
        Lifetime value counts confirmed orders (excludes pending/failed/cancelled) and is gross
        revenue from the customer, not profit.
      </p>
    </div>
  );
}
