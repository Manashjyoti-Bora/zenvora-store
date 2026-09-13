import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { Badge } from '@/components/ui/badge';
import { Card, EmptyState } from '@/components/ui/feedback';
import { MessageStatusActions } from '@/components/admin/message-actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Messages — Admin', robots: { index: false } };

export default async function AdminMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const status = ['NEW', 'READ', 'RESOLVED'].includes(sp.status ?? '') ? sp.status : undefined;

  const [messages, counts] = await Promise.all([
    prisma.contactMessage.findMany({
      where: status ? { status } : {},
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    }),
    prisma.contactMessage.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);
  const countOf = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;

  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  const tone = (s: string) => (s === 'NEW' ? 'amber' : s === 'READ' ? 'blue' : 'green');

  return (
    <div className="space-y-5">
      <header>
        <h1>Contact messages</h1>
        <p className="mt-1 text-sm text-gray-500">
          Submissions from the contact form. Reply from your configured support mailbox — the
          sender&apos;s email address is shown on each message.
        </p>
      </header>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter messages">
        {[
          { key: '', label: `All (${countOf('NEW') + countOf('READ') + countOf('RESOLVED')})` },
          { key: 'NEW', label: `New (${countOf('NEW')})` },
          { key: 'READ', label: `Read (${countOf('READ')})` },
          { key: 'RESOLVED', label: `Resolved (${countOf('RESOLVED')})` },
        ].map((t) => (
          <Link
            key={t.key}
            href={t.key ? `/admin/messages?status=${t.key}` : '/admin/messages'}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              (status ?? '') === t.key
                ? 'bg-gray-900 text-white'
                : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {messages.length === 0 ? (
        <EmptyState title="No messages" description="Contact form submissions will appear here." />
      ) : (
        <ul className="space-y-3">
          {messages.map((m) => (
            <li key={m.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge tone={tone(m.status) as 'amber' | 'blue' | 'green'}>{m.status}</Badge>
                      <span className="text-sm font-semibold text-gray-900">
                        {m.subject || '(no subject)'}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {m.name} ·{' '}
                      <a
                        href={`mailto:${m.email}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {m.email}
                      </a>
                      {' · '}
                      {fmt(m.createdAt)}
                    </p>
                  </div>
                  <MessageStatusActions id={m.id} status={m.status} />
                </div>
                <p className="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                  {m.message}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {messages.length === 100 && (
        <p className="text-xs text-gray-400">
          Showing the 100 most relevant messages — filter by status to see more.
        </p>
      )}
    </div>
  );
}
