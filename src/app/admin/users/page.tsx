import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth/session';
import { TableWrap, Th, Td, Pagination } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/feedback';
import { UserRowActions, CreateUserButton, type UserRow } from '@/components/admin/user-actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Users & roles — Admin', robots: { index: false } };

const PER_PAGE = 25;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const me = await getSessionUser();
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const roleFilter = ['CUSTOMER', 'STAFF', 'ADMIN'].includes(sp.role ?? '')
    ? (sp.role as 'CUSTOMER' | 'STAFF' | 'ADMIN')
    : undefined;

  const where = {
    ...(roleFilter ? { role: roleFilter } : {}),
    ...(sp.q?.trim()
      ? {
          OR: [
            { email: { contains: sp.q.trim(), mode: 'insensitive' as const } },
            { name: { contains: sp.q.trim(), mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [users, total, staffCount] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [{ role: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
      },
    }),
    prisma.user.count({ where }),
    prisma.user.count({ where: { role: { in: ['STAFF', 'ADMIN'] }, status: 'ACTIVE' } }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const rows: UserRow[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as UserRow['role'],
    status: u.status as UserRow['status'],
    isSelf: u.id === me?.user.id,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  }));

  const fmt = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d)
      : 'never';

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>Users &amp; roles</h1>
          <p className="mt-1 text-sm tabular-nums text-gray-500">
            {total} user{total === 1 ? '' : 's'} · {staffCount} active staff/admin
            {staffCount === 1 ? '' : 's'}
          </p>
        </div>
        <CreateUserButton />
      </header>

      <Alert tone="info">
        Role changes and disables immediately revoke the affected user&apos;s sessions. Safeguards:
        you cannot demote/disable yourself, and at least one active admin must always remain.
      </Alert>

      <form
        className="flex flex-wrap items-center gap-2"
        method="get"
        action="/admin/users"
        role="search"
      >
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ''}
          placeholder="Search name / email…"
          className="input-base w-full max-w-xs"
          aria-label="Search users"
        />
        <select
          name="role"
          defaultValue={sp.role ?? ''}
          className="input-base w-auto"
          aria-label="Filter by role"
        >
          <option value="">All roles</option>
          <option value="ADMIN">ADMIN</option>
          <option value="STAFF">STAFF</option>
          <option value="CUSTOMER">CUSTOMER</option>
        </select>
        <button
          type="submit"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Filter
        </button>
        {(sp.q || sp.role) && (
          <Link href="/admin/users" className="text-sm text-brand-700 hover:underline">
            Clear
          </Link>
        )}
      </form>

      <TableWrap>
        <table className="table-base">
          <thead className="bg-gray-50">
            <tr>
              <Th>User</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th className="hidden md:table-cell">Joined</Th>
              <Th className="hidden lg:table-cell">Last login</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 && (
              <tr>
                <Td className="py-8 text-center text-gray-400">No users match.</Td>
              </tr>
            )}
            {rows.map((u) => (
              <tr key={u.id} className="hover:bg-gray-50/60">
                <Td>
                  <p className="font-medium text-gray-900">
                    {u.name}
                    {u.isSelf && (
                      <span className="ml-2 text-[10px] font-normal text-brand-700">(you)</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400">{u.email}</p>
                </Td>
                <Td>
                  <Badge
                    tone={u.role === 'ADMIN' ? 'purple' : u.role === 'STAFF' ? 'blue' : 'neutral'}
                  >
                    {u.role}
                  </Badge>
                </Td>
                <Td>
                  <Badge tone={u.status === 'ACTIVE' ? 'green' : 'red'}>{u.status}</Badge>
                </Td>
                <Td className="hidden text-[11px] text-gray-400 md:table-cell">
                  {fmt(new Date(u.createdAt))}
                </Td>
                <Td className="hidden text-[11px] text-gray-400 lg:table-cell">
                  {fmt(u.lastLoginAt ? new Date(u.lastLoginAt) : null)}
                </Td>
                <Td className="text-right">
                  <UserRowActions user={u} />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      <Pagination
        page={page}
        totalPages={totalPages}
        basePath="/admin/users"
        searchParams={{ q: sp.q, role: sp.role }}
      />
    </div>
  );
}
