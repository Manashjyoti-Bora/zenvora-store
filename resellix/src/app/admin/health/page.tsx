import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import {
  env,
  isRazorpayConfigured,
  isTestPaymentsAllowed,
  isDemoSupplierAllowed,
  isProduction,
} from '@/lib/env';
import { describePaymentProvider } from '@/lib/payments';
import { getSettings } from '@/lib/settings';
import { Card, Alert } from '@/components/ui/feedback';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'System health — Admin', robots: { index: false } };

type CheckState = 'ok' | 'warn' | 'bad';

function StatusDot({ state }: { state: CheckState }) {
  const cls = state === 'ok' ? 'bg-emerald-500' : state === 'warn' ? 'bg-amber-500' : 'bg-red-500';
  return (
    <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${cls}`} aria-hidden="true">
      <span className="sr-only">{state}</span>
    </span>
  );
}

function CheckRow({
  state,
  label,
  detail,
}: {
  state: CheckState;
  label: string;
  detail: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 border-b border-gray-100 py-2.5 last:border-0">
      <span className="mt-1.5">
        <StatusDot state={state} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-800">{label}</p>
        <div className="mt-0.5 text-xs text-gray-500">{detail}</div>
      </div>
    </li>
  );
}

function ConfigItem({ set, name, required }: { set: boolean; name: string; required?: boolean }) {
  return (
    <li className="flex items-center justify-between gap-2 border-b border-gray-100 py-1.5 text-xs last:border-0">
      <code className="font-mono text-gray-700">{name}</code>
      {set ? (
        <Badge tone="green">set</Badge>
      ) : required ? (
        <Badge tone="red">missing — required</Badge>
      ) : (
        <Badge tone="gray">not set — optional</Badge>
      )}
    </li>
  );
}

export default async function AdminHealthPage() {
  const started = Date.now();
  let dbOk = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbOk = false;
  }
  const dbLatencyMs = Date.now() - started;

  const [
    settings,
    provider,
    jobStats,
    notifyStats,
    webhookRejected24h,
    supplierFailures7d,
    activeSuppliers,
    failedSupplierOrders,
    stalePending,
  ] = await Promise.all([
    getSettings(),
    Promise.resolve(describePaymentProvider()),
    prisma.job.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.job.groupBy({
      by: ['status'],
      where: { type: 'SEND_NOTIFICATION', createdAt: { gte: new Date(Date.now() - 7 * 864e5) } },
      _count: { _all: true },
    }),
    prisma.webhookEvent.count({
      where: { status: 'REJECTED', receivedAt: { gte: new Date(Date.now() - 864e5) } },
    }),
    prisma.supplierOrder.count({
      where: { status: 'FAILED', updatedAt: { gte: new Date(Date.now() - 7 * 864e5) } },
    }),
    prisma.supplier.groupBy({ by: ['type'], where: { isActive: true }, _count: { _all: true } }),
    prisma.supplierOrder.findMany({
      where: { status: 'FAILED' },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        orderId: true,
        lastError: true,
        updatedAt: true,
        order: { select: { orderNumber: true } },
      },
    }),
    prisma.job.findFirst({
      where: { status: 'PENDING', nextRunAt: { lt: new Date(Date.now() - 15 * 60 * 1000) } },
      orderBy: { nextRunAt: 'asc' },
      select: { type: true, nextRunAt: true },
    }),
  ]);

  const jobCount = (s: string) => jobStats.find((j) => j.status === s)?._count._all ?? 0;
  const notifyCount = (s: string) => notifyStats.find((j) => j.status === s)?._count._all ?? 0;

  const smtpConfigured =
    env.EMAIL_PROVIDER === 'smtp' && Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
  const razorpayWebhookReady = Boolean(env.RAZORPAY_WEBHOOK_SECRET);
  const productionBlockers: string[] = [];
  if (isProduction && !isRazorpayConfigured())
    productionBlockers.push('Razorpay credentials not configured');
  if (isProduction && env.EMAIL_PROVIDER !== 'smtp')
    productionBlockers.push('Email provider is console — customers would not receive emails');
  if (settings.demoMode && isProduction) productionBlockers.push('Demo mode is ON in production');
  if (!env.CRON_SECRET)
    productionBlockers.push('CRON_SECRET not set — /api/cron/jobs is unprotected or disabled');

  return (
    <div className="space-y-5">
      <header>
        <h1>System health</h1>
        <p className="mt-1 text-sm text-gray-500">
          Live integration status. The public liveness probe is{' '}
          <Link href="/api/health" className="font-mono text-brand-700 hover:underline">
            /api/health
          </Link>
          . This page never displays secret <em>values</em> — only whether they are configured.
        </p>
      </header>

      {productionBlockers.length > 0 ? (
        <Alert tone="error" title="Launch blockers">
          <ul className="list-inside list-disc space-y-0.5">
            {productionBlockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <p className="mt-1">
            Resolve each item per SETUP_CHECKLIST.md before taking real orders.
          </p>
        </Alert>
      ) : (
        <Alert
          tone={isProduction ? 'success' : 'info'}
          title={isProduction ? 'No launch blockers detected' : 'Development configuration'}
        >
          {!isProduction && (
            <p>
              Running in <strong>{env.NODE_ENV}</strong> mode. The TEST payment provider
              {isTestPaymentsAllowed()
                ? ' is ENABLED (hard-disabled in production builds)'
                : ' is disabled'}{' '}
              and the demo supplier {isDemoSupplierAllowed() ? 'is ENABLED' : 'is disabled'}. Real
              money never moves in this mode.
            </p>
          )}
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Core systems</h2>
          <ul>
            <CheckRow
              state={dbOk ? (dbLatencyMs > 500 ? 'warn' : 'ok') : 'bad'}
              label="PostgreSQL"
              detail={
                dbOk
                  ? `reachable · query round-trip ${dbLatencyMs} ms`
                  : 'UNREACHABLE — the whole app depends on this'
              }
            />
            <CheckRow
              state={
                provider.kind === 'RAZORPAY'
                  ? 'ok'
                  : provider.kind === 'TEST'
                    ? isProduction
                      ? 'bad'
                      : 'warn'
                    : isProduction
                      ? 'bad'
                      : 'warn'
              }
              label={`Payments — ${provider.label}`}
              detail={
                <>
                  mode: <code>{settings.demoMode ? 'demo settings ON' : 'demo settings OFF'}</code>{' '}
                  · webhook secret{' '}
                  {razorpayWebhookReady ? 'set' : 'not set (webhook deliveries will be REJECTED)'} ·{' '}
                  TEST provider can never activate in production builds
                </>
              }
            />
            <CheckRow
              state={smtpConfigured ? 'ok' : env.EMAIL_PROVIDER === 'smtp' ? 'bad' : 'warn'}
              label={`Email — provider: ${env.EMAIL_PROVIDER}`}
              detail={
                smtpConfigured
                  ? `SMTP ${env.SMTP_HOST}:${env.SMTP_PORT} · from ${env.EMAIL_FROM}`
                  : env.EMAIL_PROVIDER === 'smtp'
                    ? 'SMTP selected but host/user/pass incomplete — emails will FAIL'
                    : 'console provider: emails are logged server-side, not sent. Fine for development; required for launch.'
              }
            />
            <CheckRow
              state={jobCount('FAILED') > 0 ? 'bad' : stalePending ? 'warn' : 'ok'}
              label="Job queue"
              detail={
                <>
                  pending {jobCount('PENDING')} · running {jobCount('RUNNING')} · done{' '}
                  {jobCount('DONE')} · failed{' '}
                  <Link
                    href="/admin/logs/jobs?status=FAILED"
                    className={
                      jobCount('FAILED') > 0
                        ? 'font-semibold text-red-600 hover:underline'
                        : 'hover:underline'
                    }
                  >
                    {jobCount('FAILED')}
                  </Link>
                  {stalePending && (
                    <>
                      {' '}
                      ·{' '}
                      <span className="text-amber-600">
                        oldest pending job ({stalePending.type}) was due{' '}
                        {Math.round((Date.now() - stalePending.nextRunAt.getTime()) / 60000)} min
                        ago — cron runner may be offline
                      </span>
                    </>
                  )}
                </>
              }
            />
            <CheckRow
              state={webhookRejected24h > 0 ? 'warn' : 'ok'}
              label="Webhook intake"
              detail={
                <>
                  {webhookRejected24h} rejected (signature/payload) in last 24h ·{' '}
                  <Link href="/admin/logs/webhooks" className="hover:underline">
                    open webhook log
                  </Link>
                </>
              }
            />
          </ul>
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">
            Suppliers &amp; notifications
          </h2>
          <ul>
            <CheckRow
              state={activeSuppliers.length === 0 ? 'warn' : supplierFailures7d > 0 ? 'bad' : 'ok'}
              label="Supplier integrations"
              detail={
                activeSuppliers.length === 0 ? (
                  'No active suppliers — orders cannot be fulfilled. Add one under Suppliers.'
                ) : (
                  <>
                    {activeSuppliers.map((s) => (
                      <span key={s.type} className="mr-2">
                        {s.type.replace('_', ' ')}: {s._count._all}
                      </span>
                    ))}
                    · {supplierFailures7d} failed supplier order
                    {supplierFailures7d === 1 ? '' : 's'} in last 7 days
                  </>
                )
              }
            />
            <CheckRow
              state={notifyCount('FAILED') > 0 ? 'warn' : 'ok'}
              label="Email notifications (7 days)"
              detail={
                <>
                  sent {notifyCount('DONE')} · queued{' '}
                  {notifyCount('PENDING') + notifyCount('RUNNING')} · failed {notifyCount('FAILED')}
                  {notifyCount('FAILED') > 0 && (
                    <>
                      {' '}
                      —{' '}
                      <Link
                        href="/admin/logs/jobs?type=SEND_NOTIFICATION&status=FAILED"
                        className="text-red-600 hover:underline"
                      >
                        inspect &amp; retry
                      </Link>
                    </>
                  )}
                </>
              }
            />
          </ul>

          {failedSupplierOrders.length > 0 && (
            <div className="mt-3 rounded-lg bg-red-50/60 p-3">
              <p className="text-xs font-semibold text-red-700">
                Recent supplier fulfilment failures
              </p>
              <ul className="mt-1.5 space-y-1">
                {failedSupplierOrders.map((f) => (
                  <li key={f.id} className="text-[11px] text-red-600">
                    <Link
                      href={`/admin/orders/${f.orderId}`}
                      className="font-mono font-semibold hover:underline"
                    >
                      {f.order.orderNumber}
                    </Link>
                    {f.lastError && (
                      <span className="ml-1 text-red-500/80">— {f.lastError.slice(0, 90)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="mb-1 text-sm font-semibold text-gray-900">Environment configuration</h2>
        <p className="mb-3 text-xs text-gray-500">
          Presence check only — values are never rendered here or sent to the browser. Full guidance
          in <code>.env.example</code> and SETUP_CHECKLIST.md.
        </p>
        <div className="grid gap-x-8 gap-y-0 sm:grid-cols-2 lg:grid-cols-3">
          <ul>
            <ConfigItem set name="DATABASE_URL" required />
            <ConfigItem
              set={isRazorpayConfigured()}
              name="RAZORPAY_KEY_ID + SECRET"
              required={isProduction}
            />
            <ConfigItem
              set={Boolean(env.NEXT_PUBLIC_RAZORPAY_KEY_ID)}
              name="NEXT_PUBLIC_RAZORPAY_KEY_ID"
              required={isProduction}
            />
          </ul>
          <ul>
            <ConfigItem
              set={razorpayWebhookReady}
              name="RAZORPAY_WEBHOOK_SECRET"
              required={isProduction}
            />
            <ConfigItem set={Boolean(env.SUPPLIER_WEBHOOK_SECRET)} name="SUPPLIER_WEBHOOK_SECRET" />
            <ConfigItem set={Boolean(env.CRON_SECRET)} name="CRON_SECRET" required={isProduction} />
          </ul>
          <ul>
            <ConfigItem
              set={smtpConfigured}
              name="SMTP_HOST / USER / PASS"
              required={isProduction}
            />
            <ConfigItem set name={`EMAIL_FROM (${env.EMAIL_FROM})`} />
            <ConfigItem set name={`APP_URL (${env.APP_URL})`} required />
          </ul>
        </div>
      </Card>
    </div>
  );
}
