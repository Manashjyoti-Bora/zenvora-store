import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { TableWrap, Th, Td, Pagination } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, Card } from '@/components/ui/feedback';
import type { WebhookSource, WebhookStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Webhook log — Admin', robots: { index: false } };

const PER_PAGE = 30;

export default async function WebhookLogPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; status?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const where = {
    ...(sp.source === 'PAYMENT' || sp.source === 'SUPPLIER'
      ? { source: sp.source as WebhookSource }
      : {}),
    ...(sp.status ? { status: sp.status as WebhookStatus } : {}),
  };

  const [events, total, rejected24h] = await Promise.all([
    prisma.webhookEvent.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
    prisma.webhookEvent.count({ where }),
    prisma.webhookEvent.count({
      where: { status: 'REJECTED', receivedAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const fmt = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'medium' }).format(d)
      : '—';
  const tone = (s: WebhookStatus) =>
    s === 'PROCESSED' ? 'green' : s === 'DUPLICATE' ? 'blue' : s === 'REJECTED' ? 'red' : 'amber';

  return (
    <div className="space-y-5">
      <header>
        <h1>Webhook log</h1>
        <p className="mt-1 text-sm tabular-nums text-gray-500">
          {total} received event{total === 1 ? '' : 's'} (payment gateway + supplier webhooks).
          Every delivery is signature-verified before processing; duplicates are detected via
          provider event IDs.
        </p>
      </header>

      {rejected24h > 0 && (
        <Alert
          tone="error"
          title={`${rejected24h} rejected webhook${rejected24h === 1 ? '' : 's'} in the last 24h`}
        >
          Rejected = failed signature verification or invalid payload. A sudden burst usually means
          the webhook secret env var does not match the sender&apos;s configuration — check{' '}
          <code>RAZORPAY_WEBHOOK_SECRET</code> / supplier webhook secrets against your provider
          dashboard (see SETUP_CHECKLIST.md).
        </Alert>
      )}

      <form
        className="flex flex-wrap items-center gap-2"
        method="get"
        action="/admin/logs/webhooks"
      >
        <select
          name="source"
          defaultValue={sp.source ?? ''}
          className="input-base w-auto"
          aria-label="Filter by source"
        >
          <option value="">Any source</option>
          <option value="PAYMENT">Payment</option>
          <option value="SUPPLIER">Supplier</option>
        </select>
        <select
          name="status"
          defaultValue={sp.status ?? ''}
          className="input-base w-auto"
          aria-label="Filter by status"
        >
          <option value="">Any status</option>
          {['RECEIVED', 'PROCESSED', 'DUPLICATE', 'REJECTED', 'FAILED'].map((s) => (
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
        {(sp.source || sp.status) && (
          <Link href="/admin/logs/webhooks" className="text-sm text-brand-700 hover:underline">
            Clear
          </Link>
        )}
      </form>

      <TableWrap>
        <table className="table-base">
          <thead className="bg-gray-50">
            <tr>
              <Th>Received</Th>
              <Th>Source</Th>
              <Th className="hidden sm:table-cell">Event type</Th>
              <Th>Status</Th>
              <Th className="hidden lg:table-cell">Signature</Th>
              <Th className="hidden lg:table-cell">Linked</Th>
              <Th className="hidden md:table-cell">Error</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {events.length === 0 && (
              <tr>
                <Td className="py-8 text-center text-gray-400">
                  No webhook events yet — they appear once your gateway/supplier URLs are configured
                  and delivering.
                </Td>
              </tr>
            )}
            {events.map((e) => (
              <tr
                key={e.id}
                className={
                  e.status === 'REJECTED' || e.status === 'FAILED'
                    ? 'bg-red-50/40'
                    : 'hover:bg-gray-50/60'
                }
              >
                <Td className="text-[11px] text-gray-500">{fmt(e.receivedAt)}</Td>
                <Td>
                  <Badge tone={e.source === 'PAYMENT' ? 'blue' : 'purple'}>{e.source}</Badge>
                </Td>
                <Td className="hidden font-mono text-[11px] text-gray-600 sm:table-cell">
                  {e.eventType}
                </Td>
                <Td>
                  <Badge tone={tone(e.status) as 'green' | 'blue' | 'red' | 'amber'}>
                    {e.status}
                  </Badge>
                  {e.processedAt && (
                    <span className="block text-[10px] text-gray-400">
                      processed {fmt(e.processedAt)}
                    </span>
                  )}
                </Td>
                <Td className="hidden lg:table-cell">
                  <Badge tone={e.signatureValid ? 'green' : 'red'}>
                    {e.signatureValid ? 'valid' : 'invalid'}
                  </Badge>
                </Td>
                <Td className="hidden font-mono text-[10px] text-gray-400 lg:table-cell">
                  {e.paymentId && <span className="block">pay: {e.paymentId}</span>}
                  {e.orderId && (
                    <Link
                      href={`/admin/orders/${e.orderId}`}
                      className="block hover:text-brand-700"
                    >
                      order ↗
                    </Link>
                  )}
                  {!e.paymentId && !e.orderId && '—'}
                </Td>
                <Td className="hidden max-w-[200px] md:table-cell">
                  {e.error && (
                    <span className="block truncate text-[10px] text-red-500" title={e.error}>
                      {e.error}
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      <Card className="p-4 text-xs text-gray-500">
        <p className="font-medium text-gray-700">Privacy &amp; security note</p>
        <p className="mt-1">
          Stored payloads are the raw provider bodies (needed for idempotency and debugging) — they
          never contain card numbers, CVV or UPI PINs; gateways only send tokenised payment IDs.
          Secrets and signature values are never persisted.
        </p>
      </Card>

      <Pagination
        page={page}
        totalPages={totalPages}
        basePath="/admin/logs/webhooks"
        searchParams={{ source: sp.source, status: sp.status }}
      />
    </div>
  );
}
