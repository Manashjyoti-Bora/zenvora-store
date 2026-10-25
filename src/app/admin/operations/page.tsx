import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { getSessionUser } from '@/lib/auth/session';
import { PERMISSION_LEVEL_LABELS, ACTION_MIN_LEVEL, permissionLevelOf, AUTOMATION_MAX_LEVEL } from '@/lib/auth/permissions';
import { getAiStatus } from '@/lib/ai/provider';
import { describePaymentProvider } from '@/lib/payments';
import { evaluateSupplierProductCandidate, getAllSupplierSyncReports } from '@/lib/catalog/auto-import';
import { deriveLifecycleState, LIFECYCLE_LABELS, type SupplierProductLifecycleState } from '@/lib/catalog/lifecycle';
import { env, isRazorpayConfigured } from '@/lib/env';
import { collectLaunchReadiness } from '@/lib/ops/launch-blockers';
import { Badge } from '@/components/ui/badge';
import { Alert, Card } from '@/components/ui/feedback';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Operations — Admin', robots: { index: false } };

const LIFECYCLE_ORDER: SupplierProductLifecycleState[] = [
  'DISCOVERED',
  'IMPORTING',
  'VALIDATION_FAILED',
  'NEEDS_REVIEW',
  'APPROVED',
  'SCHEDULED',
  'ACTIVE',
  'STALE',
  'SUPPLIER_UNAVAILABLE',
  'PAUSED',
  'REJECTED',
];

function ago(d: Date | string | null | undefined): string {
  if (!d) return 'never';
  const ms = Date.now() - new Date(d).getTime();
  const h = Math.floor(ms / 3600e3);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60e3))} min ago`;
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/**
 * Operations dashboard: every number is read from the database or the
 * validated environment at request time. Nothing here is estimated.
 */
export default async function OperationsPage() {
  const session = await getSessionUser();
  const level = permissionLevelOf(session?.user ?? null);
  const dayAgo = new Date(Date.now() - 864e5);
  const weekAgo = new Date(Date.now() - 7 * 864e5);

  const [
    settings,
    supplierRows,
    suppliers,
    syncReports,
    jobStats,
    jobsFailed24h,
    oldestPending,
    webhookStats24h,
    rateLimitBuckets,
    ordersByStatus24h,
    pendingPaymentOld,
    auditLast,
    cronLastRun,
    productsByStatus,
    activeProducts,
  ] = await Promise.all([
    getSettings(),
    prisma.supplierProduct.findMany({
      include: { supplier: true, product: { select: { id: true, status: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    }),
    prisma.supplier.findMany({
      select: { id: true, name: true, type: true, isActive: true, _count: { select: { supplierProducts: true } } },
      orderBy: { name: 'asc' },
    }),
    getAllSupplierSyncReports(),
    prisma.job.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.job.count({ where: { status: 'FAILED', updatedAt: { gte: dayAgo } } }),
    prisma.job.findFirst({
      where: { status: 'PENDING' },
      orderBy: { nextRunAt: 'asc' },
      select: { type: true, nextRunAt: true },
    }),
    prisma.webhookEvent.groupBy({
      by: ['status'],
      where: { receivedAt: { gte: dayAgo } },
      _count: { _all: true },
    }),
    prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM rate_limit_buckets`.catch(() => [
      { n: BigInt(-1) },
    ]),
    prisma.order.groupBy({ by: ['status'], where: { placedAt: { gte: dayAgo } }, _count: { _all: true } }),
    prisma.order.count({ where: { status: 'PENDING_PAYMENT', placedAt: { lt: dayAgo, gte: weekAgo } } }),
    prisma.auditLog.findFirst({ orderBy: { createdAt: 'desc' }, select: { action: true, createdAt: true } }),
    prisma.auditLog.findFirst({
      where: { action: { startsWith: 'cron' } },
      orderBy: { createdAt: 'desc' },
      select: { action: true, createdAt: true },
    }),
    prisma.product.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.product.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        supplierId: true,
        supplierCost: true,
        supplierShippingCost: true,
        stock: true,
        supplierProduct: { select: { lastSyncedAt: true, supplierShippingCost: true, inStock: true, stockQty: true } },
      },
    }),
  ]);

  const activeRules = await prisma.pricingRule.findMany({ where: { isActive: true } });
  const lifecycleCounts = Object.fromEntries(LIFECYCLE_ORDER.map((s) => [s, 0])) as Record<
    SupplierProductLifecycleState,
    number
  >;
  const demandCounts = { VERIFIED: 0, LOW_EVIDENCE: 0, UNKNOWN: 0 };
  let staleSupplierItems = 0;
  for (const sp of supplierRows) {
    const { meta, evaluation } = evaluateSupplierProductCandidate({ sp, settings, activeRules });
    const lc = deriveLifecycleState({
      supplier: { isActive: sp.supplier.isActive },
      supplierProduct: {
        isActive: sp.isActive,
        inStock: sp.inStock,
        stockQty: sp.stockQty,
        lastSyncedAt: sp.lastSyncedAt,
        supplierCost: sp.supplierCost,
        supplierSku: sp.supplierSku,
      },
      product: sp.product ? { status: sp.product.status } : null,
      importState: meta.importState,
      evaluation,
      staleAfterHours: settings.autoImport.staleAfterHours,
    });
    lifecycleCounts[lc.state] += 1;
    demandCounts[evaluation.demandConfidence] += 1;
    if (!lc.isFresh) staleSupplierItems += 1;
  }

  // Catalogue & margin coverage — counted, not estimated.
  const productCount = (st: string) => productsByStatus.find((p) => p.status === st)?._count._all ?? 0;
  const staleMs = settings.autoImport.staleAfterHours * 3600e3;
  const activeWithCost = activeProducts.filter((p) => Number(p.supplierCost) > 0).length;
  const activeWithShipping = activeProducts.filter(
    (p) => Number(p.supplierShippingCost) > 0 || p.supplierProduct?.supplierShippingCost != null
  ).length;
  const activeSupplierLinked = activeProducts.filter((p) => p.supplierId).length;
  const activeStaleSupplier = activeProducts.filter(
    (p) =>
      p.supplierProduct &&
      (!p.supplierProduct.lastSyncedAt || Date.now() - p.supplierProduct.lastSyncedAt.getTime() > staleMs)
  ).length;
  const activeUnknownStock = activeProducts.filter((p) =>
    p.supplierProduct ? p.supplierProduct.stockQty == null && p.supplierProduct.inStock == null : p.stock <= 0
  ).length;
  const readiness = collectLaunchReadiness({
    settings,
    env,
    razorpayConfigured: isRazorpayConfigured(),
    isProduction: env.NODE_ENV === 'production',
  });

  const jobCount = (s: string) => jobStats.find((j) => j.status === s)?._count._all ?? 0;
  const whCount = (s: string) => webhookStats24h.find((j) => j.status === s)?._count._all ?? 0;
  const ordersCount = (s: string) => ordersByStatus24h.find((j) => j.status === s)?._count._all ?? 0;
  const ai = getAiStatus();
  const payments = describePaymentProvider();
  const bucketCount = Number(rateLimitBuckets[0]?.n ?? -1);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>System &amp; supplier operations</h1>
          <p className="mt-1 text-sm text-ink-400">
            Live counts from the database and validated environment — nothing on this page is
            estimated or sampled.
          </p>
        </div>
        <div className="rounded-xl border border-ink-900/10 bg-cream-50 px-3.5 py-2 text-xs text-ink-700">
          You are <strong>level {level}</strong> — {PERMISSION_LEVEL_LABELS[level]}
        </div>
      </header>

      {/* Guards & automation posture */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card className="p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Environment</p>
          <p className="mt-1 text-sm font-semibold text-ink-900">{env.NODE_ENV}</p>
          <p className="text-[11px] text-ink-500">{process.env.VERCEL_ENV ?? 'local runtime'}</p>
        </Card>
        <Card className="p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Auto-publish</p>
          <p className="mt-1">
            <Badge tone={settings.autoImport.autoPublishEligible ? 'amber' : 'green'}>
              {settings.autoImport.autoPublishEligible ? 'ENABLED' : 'DISABLED'}
            </Badge>
          </p>
          <p className="text-[11px] text-ink-500">owner decision required to enable</p>
        </Card>
        <Card className="p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Live supplier ordering</p>
          <p className="mt-1">
            <Badge tone={settings.autoImport.supplierLiveOrderingEnabled ? 'amber' : 'green'}>
              {settings.autoImport.supplierLiveOrderingEnabled ? 'ENABLED' : 'DISABLED'}
            </Badge>
          </p>
          <p className="text-[11px] text-ink-500">no real supplier orders are placed while disabled</p>
        </Card>
        <Card className="p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Payments</p>
          <p className="mt-1 text-sm font-semibold text-ink-900">{payments.label}</p>
          <p className="text-[11px] text-ink-500">
            {payments.kind === 'NONE' ? 'not configured' : payments.isTest ? 'test mode' : 'configured'}
          </p>
        </Card>
        <Card className="p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">AI assist</p>
          <p className="mt-1">
            <Badge tone="gray">DISABLED</Badge>
          </p>
          <p className="text-[11px] text-ink-500">{ai.fallback.toLowerCase()} fallbacks only</p>
        </Card>
        <Card className="p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Automation ceiling</p>
          <p className="mt-1 text-sm font-semibold text-ink-900">level {AUTOMATION_MAX_LEVEL}</p>
          <p className="text-[11px] text-ink-500">
            publish requires level {ACTION_MIN_LEVEL['catalog.publish']}
          </p>
        </Card>
      </div>

      {/* Catalogue & margin coverage */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink-900">Catalogue &amp; margin coverage</h2>
          <Link href="/admin/products" className="text-xs font-semibold text-brand-700 hover:underline">
            Products →
          </Link>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Active products</dt>
            <dd className="text-lg font-bold tabular-nums text-ink-900">{activeProducts.length}</dd>
            <dd className="text-[11px] text-ink-500">
              draft {productCount('DRAFT')} · archived {productCount('ARCHIVED')}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Known supplier cost</dt>
            <dd className="text-lg font-bold tabular-nums text-ink-900">
              {activeWithCost}/{activeProducts.length}
            </dd>
            <dd className="text-[11px] text-ink-500">margin computable</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Known shipping cost</dt>
            <dd className="text-lg font-bold tabular-nums text-ink-900">
              {activeWithShipping}/{activeProducts.length}
            </dd>
            <dd className="text-[11px] text-ink-500">others use an estimate</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Supplier-linked</dt>
            <dd className="text-lg font-bold tabular-nums text-ink-900">{activeSupplierLinked}</dd>
            <dd className="text-[11px] text-ink-500">of active</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Stale supplier data</dt>
            <dd className={`text-lg font-bold tabular-nums ${activeStaleSupplier > 0 ? 'text-amber-700' : 'text-ink-900'}`}>
              {activeStaleSupplier}
            </dd>
            <dd className="text-[11px] text-ink-500">active, synced &gt; {settings.autoImport.staleAfterHours} h ago</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Unknown stock</dt>
            <dd className={`text-lg font-bold tabular-nums ${activeUnknownStock > 0 ? 'text-amber-700' : 'text-ink-900'}`}>
              {activeUnknownStock}
            </dd>
            <dd className="text-[11px] text-ink-500">active, no stock evidence</dd>
          </div>
        </dl>
      </Card>

      {(readiness.blockers.length > 0 || readiness.configGaps.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {readiness.blockers.length > 0 && (
            <Alert tone="error" title={`Launch blockers (${readiness.blockers.length})`}>
              <ul className="list-inside list-disc space-y-0.5">
                {readiness.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Alert>
          )}
          {readiness.configGaps.length > 0 && (
            <Alert tone="warning" title={`Configuration gaps (${readiness.configGaps.length})`}>
              <ul className="list-inside list-disc space-y-0.5">
                {readiness.configGaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </Alert>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Supplier lifecycle */}
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-ink-900">Supplier product lifecycle</h2>
            <span className="text-[11px] text-ink-500">
              {supplierRows.length} row(s){supplierRows.length === 500 ? ' (newest 500)' : ''}
            </span>
          </div>
          {supplierRows.length === 0 ? (
            <p className="mt-3 text-sm text-ink-500">
              No supplier products discovered yet. Run a discovery sync from{' '}
              <Link href="/admin/supplier-products" className="link-primary">
                Product mapping
              </Link>
              .
            </p>
          ) : (
            <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {LIFECYCLE_ORDER.map((s) => (
                <li key={s} className="rounded-lg border border-ink-900/10 bg-cream-50 px-3 py-2">
                  <p className="text-[11px] text-ink-500">{LIFECYCLE_LABELS[s]}</p>
                  <p className="text-lg font-bold tabular-nums text-ink-900">{lifecycleCounts[s]}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-ink-500">
            Demand evidence: verified {demandCounts.VERIFIED} · low {demandCounts.LOW_EVIDENCE} · unknown{' '}
            {demandCounts.UNKNOWN}. Items past the {settings.autoImport.staleAfterHours} h freshness window:{' '}
            {staleSupplierItems}.
          </p>
        </Card>

        {/* Suppliers & last syncs */}
        <Card className="p-4">
          <h2 className="text-sm font-bold text-ink-900">Suppliers &amp; last sync</h2>
          {suppliers.length === 0 ? (
            <p className="mt-3 text-sm text-ink-500">No suppliers configured.</p>
          ) : (
            <ul className="mt-3 divide-y divide-ink-900/[0.06] text-sm">
              {suppliers.map((s) => {
                const rep = syncReports.find((r) => r.supplierId === s.id) ?? null;
                return (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink-900">
                        {s.name} <span className="text-xs text-ink-400">({s.type})</span>
                      </p>
                      <p className="text-[11px] text-ink-500">
                        {s._count.supplierProducts} discovered · last sync{' '}
                        {rep ? `${ago(rep.completedAt)} · ${rep.status}` : 'never'}
                        {rep && rep.totals.failed > 0 ? ` · ${rep.totals.failed} failed` : ''}
                      </p>
                    </div>
                    <Badge tone={s.isActive ? 'green' : 'gray'}>{s.isActive ? 'active' : 'inactive'}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Jobs & webhooks */}
        <Card className="p-4">
          <h2 className="text-sm font-bold text-ink-900">Job queue &amp; webhooks</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-ink-500">Pending / running</dt>
            <dd className="tabular-nums font-semibold">
              {jobCount('PENDING')} / {jobCount('RUNNING')}
            </dd>
            <dt className="text-ink-500">Failed (24 h) / total failed</dt>
            <dd className="tabular-nums font-semibold">
              {jobsFailed24h} / {jobCount('FAILED')}
            </dd>
            <dt className="text-ink-500">Oldest pending</dt>
            <dd className="tabular-nums">
              {oldestPending ? `${oldestPending.type} · due ${ago(oldestPending.nextRunAt)}` : 'none'}
            </dd>
            <dt className="text-ink-500">Webhooks (24 h)</dt>
            <dd className="tabular-nums">
              {whCount('PROCESSED')} processed · {whCount('DUPLICATE')} duplicate · {whCount('REJECTED')} rejected ·{' '}
              {whCount('FAILED')} failed
            </dd>
            <dt className="text-ink-500">Rate-limit buckets</dt>
            <dd className="tabular-nums">{bucketCount < 0 ? 'table unavailable' : bucketCount}</dd>
            <dt className="text-ink-500">Daily cron</dt>
            <dd className="tabular-nums">
              {env.CRON_SECRET ? 'secret set' : 'CRON_SECRET missing'} · last audit:{' '}
              {cronLastRun ? `${cronLastRun.action} ${ago(cronLastRun.createdAt)}` : 'no cron audit rows'}
            </dd>
          </dl>
          <p className="mt-2 text-[11px] text-ink-500">
            <Link href="/admin/logs/jobs" className="link-primary">
              Job log
            </Link>{' '}
            ·{' '}
            <Link href="/admin/logs/webhooks" className="link-primary">
              Webhook log
            </Link>{' '}
            ·{' '}
            <Link href="/admin/health" className="link-primary">
              System health
            </Link>
          </p>
        </Card>

        {/* Orders (24h) */}
        <Card className="p-4">
          <h2 className="text-sm font-bold text-ink-900">Orders — last 24 h</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-ink-500">Pending payment</dt>
            <dd className="tabular-nums font-semibold">{ordersCount('PENDING_PAYMENT')}</dd>
            <dt className="text-ink-500">Confirmed</dt>
            <dd className="tabular-nums font-semibold">{ordersCount('ORDER_CONFIRMED')}</dd>
            <dt className="text-ink-500">Sent to supplier / processing</dt>
            <dd className="tabular-nums font-semibold">
              {ordersCount('SENT_TO_SUPPLIER') + ordersCount('PROCESSING')}
            </dd>
            <dt className="text-ink-500">Cancelled</dt>
            <dd className="tabular-nums font-semibold">{ordersCount('CANCELLED')}</dd>
            <dt className="text-ink-500">Abandoned payments (1–7 d old)</dt>
            <dd className="tabular-nums font-semibold">{pendingPaymentOld}</dd>
            <dt className="text-ink-500">Last audit entry</dt>
            <dd className="tabular-nums">
              {auditLast ? `${auditLast.action} · ${ago(auditLast.createdAt)}` : 'none'}
            </dd>
          </dl>
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="text-sm font-bold text-ink-900">Permission levels</h2>
        <ul className="mt-2 grid grid-cols-1 gap-1 text-xs text-ink-600 sm:grid-cols-5">
          {([0, 1, 2, 3, 4] as const).map((l) => (
            <li key={l} className={`rounded-lg border px-2.5 py-1.5 ${l === level ? 'border-brand-300 bg-brand-50' : 'border-ink-900/10'}`}>
              <span className="font-semibold text-ink-900">{l}</span> · {PERMISSION_LEVEL_LABELS[l]}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-ink-500">
          Publishing, settings, payments and user management require level 4. Unattended automation
          (cron, job runner, future AI helpers) is capped at level {AUTOMATION_MAX_LEVEL} and cannot change
          this policy.
        </p>
      </Card>
    </div>
  );
}
