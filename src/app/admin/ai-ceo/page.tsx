import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { env } from '@/lib/env';
import { getSessionUser } from '@/lib/auth/session';
import { PERMISSION_LEVEL_LABELS, permissionLevelOf } from '@/lib/auth/permissions';
import { formatINR } from '@/lib/money';
import { loadAiCeoSnapshotSafe } from '@/lib/ai-ceo/snapshot';
import { buildAiCeoReport } from '@/lib/ai-ceo/engine';
import { loadRecentAiCeoRuns } from '@/lib/ai-ceo/action-executor';
import { loadAiCeoHistory } from '@/lib/ai-ceo/history-loader';
import { historyCounts } from '@/lib/ai-ceo/history';
import { narrativeTokensUsed } from '@/lib/ai-ceo/narrative-service';
import { AiCeoRetryButton } from '@/components/admin/ai-ceo-retry-button';
import { AI_CEO_ACTIONS } from '@/lib/ai-ceo/actions';
import { EVIDENCE_LABELS, HEALTH_LABELS } from '@/lib/ai-ceo/contracts';
import type {
  EvidenceBasis,
  HealthLevel,
  Metric,
  ReadinessItem,
  Recommendation,
  Risk,
} from '@/lib/ai-ceo/contracts';
import { Badge } from '@/components/ui/badge';
import { Card, StatCard, Alert, EmptyState } from '@/components/ui/feedback';
import { AiCeoActionQueue, type ExecutableActionView } from '@/components/admin/ai-ceo-action-queue';
import { AiCeoControls } from '@/components/admin/ai-ceo-controls';
import { AiCeoNarrative } from '@/components/admin/ai-ceo-narrative';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'AI CEO — Admin', robots: { index: false } };

const HEALTH_TONE: Record<HealthLevel, 'green' | 'amber' | 'red' | 'gray'> = {
  OK: 'green',
  WATCH: 'amber',
  ACTION: 'amber',
  CRITICAL: 'red',
  UNKNOWN: 'gray',
};

const BASIS_TONE: Record<EvidenceBasis, 'green' | 'blue' | 'amber' | 'gray'> = {
  VERIFIED: 'green',
  DERIVED: 'blue',
  ESTIMATE: 'amber',
  UNKNOWN: 'gray',
};

const SEVERITY_TONE: Record<Risk['severity'], 'red' | 'amber' | 'blue' | 'gray'> = {
  CRITICAL: 'red',
  HIGH: 'amber',
  MEDIUM: 'blue',
  LOW: 'gray',
};

const READINESS_TONE: Record<ReadinessItem['status'], 'green' | 'amber' | 'red' | 'purple' | 'gray'> = {
  PASS: 'green',
  ACTION_REQUIRED: 'amber',
  NOT_CONFIGURED: 'red',
  OWNER_DECISION: 'purple',
  UNKNOWN: 'gray',
};

function MetricRow({ metric }: { metric: Metric }) {
  const value =
    metric.valuePaise !== null
      ? formatINR(metric.valuePaise)
      : metric.valueCount !== null
        ? metric.valueCount.toLocaleString('en-IN')
        : '—';
  return (
    <div className="border-b border-ink-900/[0.06] py-2 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <dt className="text-sm text-ink-600">{metric.label}</dt>
        <dd className="flex items-center gap-2">
          <span className="text-sm font-semibold tabular-nums text-ink-900">{value}</span>
          <Badge tone={BASIS_TONE[metric.basis]}>{EVIDENCE_LABELS[metric.basis]}</Badge>
        </dd>
      </div>
      <p className="mt-0.5 text-[11px] leading-relaxed text-ink-400">
        {metric.source}
        {metric.note ? ` · ${metric.note}` : ''}
      </p>
    </div>
  );
}

function RecommendationCard({ rec }: { rec: Recommendation }) {
  return (
    <article className="rounded-xl border border-ink-900/10 bg-white p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-eyebrow text-brand-700">
            P{rec.priority} · {rec.category.toLowerCase()}
          </p>
          <h3 className="mt-0.5 text-sm font-bold leading-snug text-ink-900">{rec.issue}</h3>
        </div>
        <Badge tone={rec.proposedAction.requiresApproval ? 'amber' : rec.proposedAction.executable ? 'blue' : 'gray'}>
          {rec.proposedAction.requiresApproval ? 'Approval required' : rec.proposedAction.executable ? 'Executable' : 'Advice'}
        </Badge>
      </header>

      <dl className="mt-3 space-y-2 text-xs leading-relaxed">
        <div>
          <dt className="font-semibold text-ink-700">Objective</dt>
          <dd className="text-ink-500">{rec.objective}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink-700">Evidence</dt>
          <dd>
            <ul className="mt-1 space-y-1">
              {rec.evidence.map((e) => (
                <li key={`${rec.id}-${e.label}`} className="flex flex-wrap items-baseline gap-1.5">
                  <span className="font-medium text-ink-600">{e.label}:</span>
                  <span className="text-ink-500">{e.value}</span>
                  <Badge tone={BASIS_TONE[e.basis]}>{EVIDENCE_LABELS[e.basis]}</Badge>
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink-700">Confidence — {rec.confidence.level.toLowerCase()}</dt>
          <dd className="text-ink-500">{rec.confidence.basis}</dd>
        </div>
        {rec.expectedBenefit && (
          <div>
            <dt className="font-semibold text-ink-700">Measurable effect</dt>
            <dd className="text-ink-500">{rec.expectedBenefit}</dd>
          </div>
        )}
        <div>
          <dt className="font-semibold text-ink-700">Proposed action</dt>
          <dd className="text-ink-500">
            {rec.proposedAction.label}. {rec.proposedAction.description}
          </dd>
        </div>
        {rec.risks.length > 0 && (
          <div>
            <dt className="font-semibold text-ink-700">Risks / uncertainty</dt>
            <dd>
              <ul className="list-disc space-y-0.5 pl-4 text-ink-500">
                {rec.risks.map((risk) => (
                  <li key={risk}>{risk}</li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        <div>
          <dt className="font-semibold text-ink-700">How the result is verified</dt>
          <dd className="text-ink-500">{rec.verification}</dd>
        </div>
      </dl>
    </article>
  );
}

export default async function AiCeoPage() {
  const session = await getSessionUser();
  const level = permissionLevelOf(session?.user ?? null);

  const [loaded, settings, suppliers, recentRuns, history, tokensUsed30d] = await Promise.all([
    loadAiCeoSnapshotSafe(),
    getSettings(),
    prisma.supplier.findMany({
      select: { id: true, name: true, isActive: true },
      orderBy: { name: 'asc' },
      take: 50,
    }),
    loadRecentAiCeoRuns(new Date()).catch(() => []),
    loadAiCeoHistory(10).catch(() => []),
    narrativeTokensUsed().catch(() => 0),
  ]);

  const header = (
    <header className="space-y-2">
      <p className="eyebrow">AI CEO · Autonomous store brain</p>
      <h1 className="text-2xl font-bold leading-tight sm:text-3xl">Executive review</h1>
      <p className="max-w-2xl text-sm leading-relaxed text-ink-400">
        Every figure here was read from the database for this request, then labelled as verified, derived,
        estimated or not measurable. The store brain cannot publish, price, refund, move money or change who
        can do what — those stay owner decisions.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-500">
        <Badge tone="gray">You are level {level} — {PERMISSION_LEVEL_LABELS[level]}</Badge>
        <Badge tone={env.NODE_ENV === 'production' ? 'green' : 'amber'}>{env.NODE_ENV}</Badge>
        <span>window: 30 days · deterministic report</span>
      </div>
    </header>
  );

  if (!loaded.ok) {
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="error" title="Verified data unavailable">
          {loaded.error}{' '}
          <Link href="/admin/health" className="underline">
            Check system health
          </Link>
          .
        </Alert>
      </div>
    );
  }

  const report = buildAiCeoReport(loaded.snapshot);
  const launchBlockers = report.readiness.filter((item) => item.blocks.includes('LAUNCH') && item.status !== 'PASS');
  const humanActions = Object.values(AI_CEO_ACTIONS).filter((a) => a.execution === 'APPROVAL_REQUIRED');
  const executable: ExecutableActionView[] = Object.values(AI_CEO_ACTIONS)
    .filter((a) => a.execution === 'ALLOWED')
    .map((a) => ({
      key: a.key,
      label: a.label,
      description: a.description,
      minLevel: a.minLevel,
      sideEffects: a.sideEffects,
      maxPerDay: a.maxPerDay,
      requiresArgs: a.key === 'RUN_SUPPLIER_DRY_RUN' ? 'SUPPLIER_DRY_RUN' : 'NONE',
    }));

  const runsLast24h = recentRuns.filter((r: { at: string }) => Date.parse(r.at) >= Date.now() - 86_400_000).length;
  const remainingToday = Math.max(0, settings.aiCeo.dailyActionLimit - runsLast24h);
  const historyStats = historyCounts(history);
  const outcomeTone = { SUCCEEDED: 'green', FAILED: 'red', REFUSED: 'amber', RECORDED: 'gray' } as const;
  const generatedAt = new Date(report.generatedAt).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div className="space-y-6">
      {header}

      {/* ---------------- Executive summary ---------------- */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-eyebrow text-ink-400">Store state</p>
            <h2 className="mt-1 text-lg font-bold leading-snug text-ink-900">{report.headline}</h2>
            <p className="mt-1 text-xs text-ink-500">Snapshot taken {generatedAt}</p>
          </div>
          <Badge tone={HEALTH_TONE[report.overallLevel]}>{HEALTH_LABELS[report.overallLevel]}</Badge>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Realised revenue"
            value={report.sales.paidOrderCount > 0 ? formatINR(report.sales.netRevenuePaise) : '—'}
            sub={report.sales.paidOrderCount > 0 ? `${report.sales.paidOrderCount} paid order(s)` : 'no paid order yet'}
            tone="info"
          />
          <StatCard
            label="Contribution"
            value={report.sales.contributionPaise !== null ? formatINR(report.sales.contributionPaise) : 'Unknown'}
            sub={
              report.sales.contributionMarginPercent !== null
                ? `${report.sales.contributionMarginPercent}% of net revenue`
                : 'costs not booked'
            }
            tone={report.sales.contributionPaise !== null && report.sales.contributionPaise < 0 ? 'negative' : 'neutral'}
          />
          <StatCard
            label="Open risks"
            value={report.risks.length}
            sub={`${report.risks.filter((r) => r.severity === 'CRITICAL').length} critical`}
            tone={report.risks.some((r) => r.severity === 'CRITICAL') ? 'negative' : 'neutral'}
          />
          <StatCard
            label="Launch blockers"
            value={launchBlockers.length}
            sub={settings.demoMode ? 'demo mode is on' : 'demo mode off'}
            tone={launchBlockers.length > 0 ? 'negative' : 'positive'}
          />
        </div>

        <ul className="mt-4 flex flex-wrap gap-1.5 text-[11px]">
          <li><Badge tone="green">Observe · on</Badge></li>
          <li><Badge tone="green">Recommend · on</Badge></li>
          <li>
            <Badge tone={report.modes.approvedLowRiskExecution ? 'blue' : 'gray'}>
              Low-risk execution · {report.modes.approvedLowRiskExecution ? 'on' : 'off'}
            </Badge>
          </li>
          <li><Badge tone="gray">Business operations · owner only</Badge></li>
          <li>
            <Badge tone={report.provider.status === 'CONFIGURED' ? 'blue' : 'gray'}>
              Model provider · {report.provider.status.toLowerCase()}
            </Badge>
          </li>
        </ul>
      </Card>

      {/* ---------------- Launch blockers ---------------- */}
      <Card title="Launch blockers & owner decisions" action={<Badge tone={launchBlockers.length ? 'red' : 'green'}>{launchBlockers.length}</Badge>}>
        {launchBlockers.length === 0 ? (
          <p className="text-sm text-ink-500">
            No readiness item is blocking launch. That is a statement about configuration, not a legal
            certification.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {launchBlockers.map((item) => (
              <li key={item.id} className="rounded-lg border border-ink-900/10 bg-cream-50/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink-900">{item.label}</p>
                  <Badge tone={READINESS_TONE[item.status]}>{item.status.replace(/_/g, ' ').toLowerCase()}</Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-ink-500">{item.detail}</p>
                {item.ownerAction && (
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-700">
                    <span className="font-semibold">Owner action:</span> {item.ownerAction}
                  </p>
                )}
                {item.needsProfessionalAdvice && (
                  <p className="mt-1 text-[11px] font-medium text-amber-700">
                    Needs qualified legal/tax review — this system does not certify compliance.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---------------- Shared readiness (Health/Operations) ---------------- */}
      <Card
        title="Shared launch readiness"
        action={
          <Badge
            tone={
              report.readinessShared.blockers.length > 0
                ? 'red'
                : report.readinessShared.configGaps.length > 0
                  ? 'amber'
                  : 'green'
            }
          >
            {report.readinessShared.blockers.length} blocker(s) · {report.readinessShared.configGaps.length} gap(s)
          </Badge>
        }
      >
        <p className="text-xs leading-relaxed text-ink-400">
          The same list Admin → Health and Admin → Operations render — passed through unchanged, so the three
          screens cannot disagree. The owner actions above add detail; they do not replace this list.
        </p>
        {report.readinessShared.blockers.length === 0 && report.readinessShared.configGaps.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">No shared blocker or configuration gap is currently open.</p>
        ) : (
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {report.readinessShared.blockers.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-[11px] font-bold uppercase tracking-eyebrow text-red-700">Blockers</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-red-900">
                  {report.readinessShared.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </div>
            )}
            {report.readinessShared.configGaps.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-[11px] font-bold uppercase tracking-eyebrow text-amber-800">
                  Configuration gaps
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-amber-900">
                  {report.readinessShared.configGaps.map((gap) => (
                    <li key={gap}>{gap}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ---------------- Risks ---------------- */}
      <Card title="Confirmed risks">
        {report.risks.length === 0 ? (
          <EmptyState title="No confirmed risks" description="Every measured operational surface is currently within its threshold." />
        ) : (
          <ul className="space-y-2.5">
            {report.risks.map((risk) => (
              <li key={risk.id} className="rounded-lg border border-ink-900/10 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink-900">{risk.title}</p>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={SEVERITY_TONE[risk.severity]}>{risk.severity.toLowerCase()}</Badge>
                    {risk.blocksLaunch && <Badge tone="red">blocks launch</Badge>}
                  </div>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-ink-500">{risk.observation}</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-700">Impact: {risk.impact}</p>
                {risk.adminHref && (
                  <Link href={risk.adminHref} className="link-primary mt-1.5 inline-block text-xs">
                    Open {risk.adminHref} →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---------------- Commerce ---------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Commerce truth">
          <dl>
            {report.sales.metrics.map((metric) => (
              <MetricRow key={metric.key} metric={metric} />
            ))}
          </dl>
          {report.sales.caveats.length > 0 && (
            <Alert tone="warning" title="Read this before using the numbers" className="mt-3">
              <ul className="list-disc space-y-0.5 pl-4">
                {report.sales.caveats.map((caveat) => (
                  <li key={caveat}>{caveat}</li>
                ))}
              </ul>
            </Alert>
          )}
        </Card>

        <Card title="Operational health">
          <ul className="space-y-2.5">
            {report.domains.map((domain) => (
              <li key={domain.id} className="rounded-lg border border-ink-900/10 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink-900">{domain.label}</p>
                  <Badge tone={HEALTH_TONE[domain.level]}>{HEALTH_LABELS[domain.level]}</Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-ink-500">{domain.summary}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* ---------------- Catalogue & suppliers ---------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Catalogue quality">
          <dl>
            {report.catalog.metrics.map((metric) => (
              <MetricRow key={metric.key} metric={metric} />
            ))}
          </dl>
        </Card>
        <Card title="Suppliers">
          <dl>
            {report.suppliers.metrics.map((metric) => (
              <MetricRow key={metric.key} metric={metric} />
            ))}
          </dl>
          {report.suppliers.failingSyncs.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-800">Syncs with failed rows</p>
              <ul className="mt-1 space-y-0.5 text-[11px] text-amber-900">
                {report.suppliers.failingSyncs.slice(0, 5).map((sync) => (
                  <li key={sync.supplierId}>
                    {sync.name}: {sync.status} — {sync.failed}/{sync.total} failed
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      {/* ---------------- Recommendations ---------------- */}
      <section className="space-y-3" aria-labelledby="recommendations-heading">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="recommendations-heading" className="text-base font-bold text-ink-900">
              Recommendations
            </h2>
            <p className="text-xs text-ink-500">
              Ranked by risk. Each one states its evidence, uncertainty and verification method — no confidence
              score is invented.
            </p>
          </div>
          <Badge tone="gray">{report.recommendations.length}</Badge>
        </div>
        {report.recommendations.length === 0 ? (
          <EmptyState title="Nothing actionable" description="No recommendation met its evidence threshold." />
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {report.recommendations.map((rec) => (
              <RecommendationCard key={rec.id} rec={rec} />
            ))}
          </div>
        )}
      </section>

      {/* ---------------- Approval queue ---------------- */}
      <Card
        title="Approval queue — owner decisions the AI will not take"
        action={<Badge tone="amber">{humanActions.length} categories</Badge>}
      >
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {humanActions.map((action) => (
            <li key={action.key} className="rounded-lg border border-ink-900/10 bg-cream-50/60 p-3">
              <p className="text-sm font-semibold text-ink-900">{action.label}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{action.description}</p>
              <p className="mt-1 text-[11px] text-ink-400">level {action.minLevel}+ · not executable here</p>
            </li>
          ))}
        </ul>
      </Card>

      {/* ---------------- Action console + controls ---------------- */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Action console (Mode 2)">
          <AiCeoActionQueue
            actions={executable}
            suppliers={suppliers}
            actionsEnabled={settings.aiCeo.actionsEnabled}
            moduleEnabled={settings.aiCeo.enabled}
            remainingToday={remainingToday}
          />
        </Card>
        <Card title="Automation controls & kill switch">
          <AiCeoControls initial={settings.aiCeo} />
          <p className="mt-3 border-t border-ink-900/10 pt-3 text-[11px] leading-relaxed text-ink-500">
            Narrative usage (30 d): <strong className="tabular-nums text-ink-700">{tokensUsed30d.toLocaleString('en-IN')}</strong>{' '}
            of {settings.aiCeo.monthlyTokenBudget.toLocaleString('en-IN')} tokens ·{' '}
            {runsLast24h} action(s) in the last 24 h of {settings.aiCeo.dailyActionLimit}.
          </p>
        </Card>
      </div>

      <Card
        title="Execution history"
        action={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone="green">{historyStats.succeeded} ran</Badge>
            <Badge tone="red">{historyStats.failed} failed</Badge>
            <Badge tone="amber">{historyStats.refused} refused</Badge>
          </span>
        }
      >
        {history.length === 0 ? (
          <p className="text-sm text-ink-500">
            No AI CEO action has run yet. Executions, failures and refused attempts all appear here — the audit
            log is the system of record.
          </p>
        ) : (
          <ul className="divide-y divide-ink-900/[0.06]">
            {history.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-800">{entry.label}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-500">
                    <span>
                      {new Date(entry.at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                    {entry.actorEmail && <span>· {entry.actorEmail}</span>}
                    {entry.code && <span>· {entry.code.replace(/_/g, ' ').toLowerCase()}</span>}
                    {entry.tokensUsed !== null && <span>· {entry.tokensUsed.toLocaleString('en-IN')} tokens</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={outcomeTone[entry.outcome]}>{entry.outcome.toLowerCase()}</Badge>
                  {entry.retryable && entry.actionKey && <AiCeoRetryButton actionKey={entry.actionKey} />}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-ink-400">
          Retries generate a fresh idempotency key and are re-checked against the kill switch, permissions and
          daily caps. Narrative text is never stored in history — only that it was generated and its token cost.
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Narrative (optional)">
          <AiCeoNarrative
            providerConfigured={report.provider.status === 'CONFIGURED'}
            narrativeEnabled={settings.aiCeo.enabled && settings.aiCeo.providerNarrativeEnabled}
          />
        </Card>
        <Card title="What this report cannot measure">
          <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-ink-500">
            {report.dataGaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-400">
            Report generated deterministically from one database snapshot. Provider status:{' '}
            {report.provider.reason}
          </p>
        </Card>
      </div>
    </div>
  );
}
