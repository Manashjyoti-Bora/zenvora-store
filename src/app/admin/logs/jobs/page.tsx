import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { TableWrap, Th, Td, Pagination } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/feedback';
import { JobsToolbar, RetryJobButton } from '@/components/admin/jobs-toolbar';
import type { JobStatus, JobType } from '@prisma/client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Job queue — Admin', robots: { index: false } };

const PER_PAGE = 30;
const TYPES: JobType[] = [
  'FULFIL_SUPPLIER_ORDER',
  'SYNC_SUPPLIER_ORDER',
  'CANCEL_SUPPLIER_ORDER',
  'SEND_NOTIFICATION',
];

export default async function JobsLogPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const where = {
    ...(sp.status ? { status: sp.status as JobStatus } : {}),
    ...(sp.type && TYPES.includes(sp.type as JobType) ? { type: sp.type as JobType } : {}),
  };

  const [jobs, total, pendingCount, failedCount] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy: [{ status: 'asc' }, { nextRunAt: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
    prisma.job.count({ where }),
    prisma.job.count({ where: { status: { in: ['PENDING', 'RUNNING'] } } }),
    prisma.job.count({ where: { status: 'FAILED' } }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const fmt = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d)
      : '—';
  const tone = (s: JobStatus) =>
    s === 'DONE' ? 'green' : s === 'FAILED' ? 'red' : s === 'RUNNING' ? 'blue' : 'amber';

  return (
    <div className="space-y-5">
      <header>
        <h1>Job queue</h1>
        <p className="mt-1 text-sm tabular-nums text-gray-500">
          Background automation: supplier fulfilment, status syncs, cancellations and notification
          emails. {pendingCount} pending/running · {failedCount} failed.
        </p>
      </header>

      {failedCount > 0 && (
        <Alert tone="error" title={`${failedCount} failed job${failedCount === 1 ? '' : 's'}`}>
          Failed jobs exhausted their retries (last error shown per row). Fix the cause (supplier
          credentials, network, bad payload) and use <em>Retry</em> — it resets attempts and runs
          immediately. Idempotency keys prevent duplicate supplier orders on retry.
        </Alert>
      )}

      <JobsToolbar />

      <form className="flex flex-wrap items-center gap-2" method="get" action="/admin/logs/jobs">
        <select
          name="status"
          defaultValue={sp.status ?? ''}
          className="input-base w-auto"
          aria-label="Filter by job status"
        >
          <option value="">Any status</option>
          {['PENDING', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          name="type"
          defaultValue={sp.type ?? ''}
          className="input-base w-auto"
          aria-label="Filter by job type"
        >
          <option value="">Any type</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Filter
        </button>
        {(sp.status || sp.type) && (
          <Link href="/admin/logs/jobs" className="text-sm text-brand-700 hover:underline">
            Clear
          </Link>
        )}
      </form>

      <TableWrap>
        <table className="table-base">
          <thead className="bg-gray-50">
            <tr>
              <Th>Type</Th>
              <Th>Status</Th>
              <Th className="hidden md:table-cell">Dedupe key</Th>
              <Th className="hidden sm:table-cell">Attempts</Th>
              <Th className="hidden lg:table-cell">Next run</Th>
              <Th className="hidden lg:table-cell">Completed</Th>
              <Th className="hidden md:table-cell">Last error</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {jobs.length === 0 && (
              <tr>
                <Td className="py-8 text-center text-gray-400">No jobs match.</Td>
              </tr>
            )}
            {jobs.map((j) => (
              <tr
                key={j.id}
                className={j.status === 'FAILED' ? 'bg-red-50/40' : 'hover:bg-gray-50/60'}
              >
                <Td className="text-[11px] font-medium text-gray-700">
                  {j.type.replace(/_/g, ' ')}
                </Td>
                <Td>
                  <Badge tone={tone(j.status) as 'green' | 'red' | 'blue' | 'amber'}>
                    {j.status}
                  </Badge>
                </Td>
                <Td className="hidden max-w-[180px] md:table-cell">
                  <span
                    className="block truncate font-mono text-[10px] text-gray-400"
                    title={j.dedupeKey ?? undefined}
                  >
                    {j.dedupeKey ?? '—'}
                  </span>
                </Td>
                <Td className="hidden text-xs tabular-nums text-gray-500 sm:table-cell">
                  {j.attempts}/{j.maxAttempts}
                </Td>
                <Td className="hidden text-[11px] text-gray-400 lg:table-cell">
                  {fmt(j.nextRunAt)}
                </Td>
                <Td className="hidden text-[11px] text-gray-400 lg:table-cell">
                  {fmt(j.completedAt)}
                </Td>
                <Td className="hidden max-w-[220px] md:table-cell">
                  {j.lastError && (
                    <span className="block truncate text-[10px] text-red-500" title={j.lastError}>
                      {j.lastError}
                    </span>
                  )}
                </Td>
                <Td className="text-right">
                  {j.status === 'FAILED' ? <RetryJobButton jobId={j.id} /> : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      <Pagination
        page={page}
        totalPages={totalPages}
        basePath="/admin/logs/jobs"
        searchParams={{ status: sp.status, type: sp.type }}
      />
    </div>
  );
}
