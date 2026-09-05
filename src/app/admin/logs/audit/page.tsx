import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { TableWrap, Th, Td, Pagination } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Audit log — Admin', robots: { index: false } };

const PER_PAGE = 40;

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; actor?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const where = {
    ...(sp.action?.trim()
      ? { action: { contains: sp.action.trim(), mode: 'insensitive' as const } }
      : {}),
    ...(sp.actor?.trim()
      ? {
          OR: [
            { actorEmail: { contains: sp.actor.trim(), mode: 'insensitive' as const } },
            { actorId: sp.actor.trim() },
          ],
        }
      : {}),
  };

  const [entries, total, actions] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
      take: 100,
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'medium' }).format(d);

  return (
    <div className="space-y-5">
      <header>
        <h1>Audit log</h1>
        <p className="mt-1 text-sm tabular-nums text-gray-500">
          {total} recorded action{total === 1 ? '' : 's'} — every admin mutation (orders, refunds,
          settings, users, suppliers, reports) with actor, hashed IP and payload summary. Entries
          are append-only.
        </p>
      </header>

      <form
        className="flex flex-wrap items-center gap-2"
        method="get"
        action="/admin/logs/audit"
        role="search"
      >
        <input
          type="search"
          name="action"
          defaultValue={sp.action ?? ''}
          list="audit-actions"
          placeholder="Action (e.g. order.cancelled)…"
          className="input-base w-full max-w-xs"
          aria-label="Filter by action"
        />
        <datalist id="audit-actions">
          {actions.map((a) => (
            <option key={a.action} value={a.action} />
          ))}
        </datalist>
        <input
          type="search"
          name="actor"
          defaultValue={sp.actor ?? ''}
          placeholder="Actor email or ID…"
          className="input-base w-full max-w-xs"
          aria-label="Filter by actor"
        />
        <button
          type="submit"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Filter
        </button>
        {(sp.action || sp.actor) && (
          <Link href="/admin/logs/audit" className="text-sm text-brand-700 hover:underline">
            Clear
          </Link>
        )}
      </form>

      <TableWrap>
        <table className="table-base">
          <thead className="bg-gray-50">
            <tr>
              <Th>When</Th>
              <Th>Actor</Th>
              <Th>Action</Th>
              <Th className="hidden md:table-cell">Entity</Th>
              <Th className="hidden lg:table-cell">Details</Th>
              <Th className="hidden xl:table-cell">IP hash / UA</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {entries.length === 0 && (
              <tr>
                <Td className="py-8 text-center text-gray-400">No audit entries match.</Td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.id} className="hover:bg-gray-50/60">
                <Td className="whitespace-nowrap text-[11px] text-gray-500">{fmt(e.createdAt)}</Td>
                <Td className="text-xs">
                  {e.actorEmail ? (
                    <span className="font-medium text-gray-800">{e.actorEmail}</span>
                  ) : (
                    <span className="text-gray-400">system</span>
                  )}
                </Td>
                <Td>
                  <Badge tone="neutral">{e.action}</Badge>
                </Td>
                <Td className="hidden text-[11px] text-gray-500 md:table-cell">
                  {e.entityType
                    ? `${e.entityType}${e.entityId ? ` · ${e.entityId.slice(0, 12)}` : ''}`
                    : '—'}
                </Td>
                <Td className="hidden max-w-[260px] lg:table-cell">
                  {e.data != null && (
                    <span
                      className="block truncate font-mono text-[10px] text-gray-400"
                      title={JSON.stringify(e.data)}
                    >
                      {JSON.stringify(e.data)}
                    </span>
                  )}
                </Td>
                <Td className="hidden max-w-[180px] text-[10px] text-gray-400 xl:table-cell">
                  {e.ipHash && (
                    <span
                      className="block truncate font-mono"
                      title="SHA-256 of IP — raw IPs are never stored"
                    >
                      {e.ipHash.slice(0, 16)}…
                    </span>
                  )}
                  {e.userAgent && <span className="block truncate">{e.userAgent}</span>}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      <Pagination
        page={page}
        totalPages={totalPages}
        basePath="/admin/logs/audit"
        searchParams={{ action: sp.action, actor: sp.actor }}
      />
    </div>
  );
}
