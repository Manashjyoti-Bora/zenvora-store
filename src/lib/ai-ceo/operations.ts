import type { AiCeoSnapshot, DomainHealth, HealthLevel, Risk } from './contracts';
import { countMetric } from './metrics';

/**
 * Operational health — pure evaluation of queue, webhook, order-pipeline and
 * error data already present in the snapshot. Thresholds are explicit constants
 * so the dashboard can explain exactly why something is amber instead of
 * leaving the owner to guess.
 */

export const THRESHOLDS = {
  /** A pending job older than this means the runner is not keeping up. */
  pendingJobWarnHours: 2,
  pendingJobActionHours: 26,
  /** Errors in 24 h before the surface turns amber. */
  errorsWarn: 1,
  errorsAction: 10,
  /** Webhook failures in 24 h before the surface turns amber. */
  webhookFailuresWarn: 1,
  /** A paid order stuck in these states for longer than N days is a delivery risk. */
  stuckFulfilmentDays: 7,
  /** Abandoned pending-payment orders (older than 24 h) worth flagging. */
  abandonedPaymentsWarn: 5,
} as const;

const LEVEL_ORDER: HealthLevel[] = ['OK', 'UNKNOWN', 'WATCH', 'ACTION', 'CRITICAL'];

export function worstLevel(levels: HealthLevel[]): HealthLevel {
  let worst: HealthLevel = 'OK';
  for (const level of levels) {
    if (LEVEL_ORDER.indexOf(level) > LEVEL_ORDER.indexOf(worst)) worst = level;
  }
  return worst;
}

export function ageHours(iso: string | null | undefined, nowIso: string): number | null {
  if (!iso) return null;
  const from = Date.parse(iso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(from) || !Number.isFinite(now)) return null;
  return Math.max(0, (now - from) / 3_600_000);
}

function agoLabel(hours: number | null): string {
  if (hours === null) return 'never';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} d`;
}

const OPEN_FULFILMENT_STATES = new Set([
  'PAYMENT_VERIFIED',
  'ORDER_CONFIRMED',
  'SENT_TO_SUPPLIER',
  'SUPPLIER_ACCEPTED',
  'PROCESSING',
]);

export function jobQueueHealth(snapshot: AiCeoSnapshot): DomainHealth {
  const { jobs } = snapshot;
  const pending = jobs.counts.PENDING ?? 0;
  const running = jobs.counts.RUNNING ?? 0;
  const failedTotal = jobs.counts.FAILED ?? 0;
  const oldestHours = ageHours(jobs.oldestPendingAt, snapshot.asOf);

  let level: HealthLevel = 'OK';
  const reasons: string[] = [];

  if (jobs.failedLast24h > 0) {
    level = worstLevel([level, 'ACTION']);
    reasons.push(`${jobs.failedLast24h} job failure(s) in the last 24 h`);
  }
  if (oldestHours !== null && oldestHours >= THRESHOLDS.pendingJobActionHours) {
    level = worstLevel([level, 'ACTION']);
    reasons.push(`oldest pending job is ${agoLabel(oldestHours)} old — the runner is not draining the queue`);
  } else if (oldestHours !== null && oldestHours >= THRESHOLDS.pendingJobWarnHours) {
    level = worstLevel([level, 'WATCH']);
    reasons.push(`oldest pending job is ${agoLabel(oldestHours)} old`);
  }
  if (pending === 0 && failedTotal === 0 && jobs.failedLast24h === 0) {
    reasons.push('queue empty with no recorded failures');
  }

  return {
    id: 'jobs',
    label: 'Background jobs',
    level,
    summary: reasons.length > 0 ? reasons.join('; ') : 'queue idle',
    metrics: [
      countMetric('pending', 'Pending', pending, 'VERIFIED', 'jobs.status = PENDING', undefined),
      countMetric('running', 'Running', running, 'VERIFIED', 'jobs.status = RUNNING', undefined),
      countMetric('failed24h', 'Failed (24 h)', jobs.failedLast24h, 'VERIFIED', 'jobs.status = FAILED and updatedAt in last 24 h', undefined),
      countMetric('failedTotal', 'Failed (all time)', failedTotal, 'VERIFIED', 'jobs.status = FAILED', undefined),
      countMetric(
        'oldestPendingHours',
        'Oldest pending (hours)',
        oldestHours === null ? null : Math.round(oldestHours),
        jobs.oldestPendingAt ? 'DERIVED' : 'UNKNOWN',
        'jobs.nextRunAt of the oldest PENDING job',
        jobs.oldestPendingType ? `Type: ${jobs.oldestPendingType}` : undefined
      ),
    ],
    evidence: [
      {
        label: 'Oldest pending job',
        value: jobs.oldestPendingAt ? `${jobs.oldestPendingType ?? 'unknown'} — due ${agoLabel(oldestHours)} ago` : 'none queued',
        source: 'jobs (PENDING, ordered by nextRunAt)',
        basis: 'VERIFIED',
      },
    ],
  };
}

export function webhookHealth(snapshot: AiCeoSnapshot): DomainHealth {
  const byStatus = snapshot.webhooks.last24hByStatus;
  const processed = byStatus.PROCESSED ?? 0;
  const duplicate = byStatus.DUPLICATE ?? 0;
  const rejected = byStatus.REJECTED ?? 0;
  const failed = byStatus.FAILED ?? 0;

  const levels: HealthLevel[] = ['OK'];
  const reasons: string[] = [];
  if (failed >= THRESHOLDS.webhookFailuresWarn) {
    levels.push('ACTION');
    reasons.push(`${failed} webhook(s) failed processing`);
  }
  if (rejected > 0) {
    levels.push('WATCH');
    reasons.push(`${rejected} webhook call(s) rejected (signature or payload invalid)`);
  }
  if (processed > 0) reasons.push(`${processed} processed`);

  return {
    id: 'webhooks',
    label: 'Payment webhooks',
    level: worstLevel(levels),
    summary: reasons.length > 0 ? reasons.join('; ') : 'no webhook traffic in 24 h',
    metrics: [
      countMetric('processed', 'Processed (24 h)', processed, 'VERIFIED', 'webhook_events.status = PROCESSED', undefined),
      countMetric('duplicate', 'Duplicates (24 h)', duplicate, 'VERIFIED', 'webhook_events.status = DUPLICATE', 'Repeat deliveries handled idempotently.'),
      countMetric('rejected', 'Rejected (24 h)', rejected, 'VERIFIED', 'webhook_events.status = REJECTED', 'Signature verification or payload validation failed.'),
      countMetric('failed', 'Failed (24 h)', failed, 'VERIFIED', 'webhook_events.status = FAILED', undefined),
    ],
    evidence: [
      {
        label: 'Webhook outcomes (24 h)',
        value: `processed ${processed} · duplicate ${duplicate} · rejected ${rejected} · failed ${failed}`,
        source: 'webhook_events grouped by status',
        basis: 'VERIFIED',
      },
    ],
  };
}

export function errorHealth(snapshot: AiCeoSnapshot): DomainHealth {
  const { last24h, fatalLast24h } = snapshot.errors;
  const levels: HealthLevel[] = ['OK'];
  if (fatalLast24h > 0) levels.push('CRITICAL');
  else if (last24h >= THRESHOLDS.errorsAction) levels.push('ACTION');
  else if (last24h >= THRESHOLDS.errorsWarn) levels.push('WATCH');

  return {
    id: 'errors',
    label: 'Application errors',
    level: worstLevel(levels),
    summary:
      last24h === 0
        ? 'no errors logged in 24 h'
        : `${last24h} error record(s) in 24 h${fatalLast24h > 0 ? `, including ${fatalLast24h} fatal` : ''}`,
    metrics: [
      countMetric('errors24h', 'Errors (24 h)', last24h, 'VERIFIED', 'error_logs.createdAt within 24 h', undefined),
      countMetric('fatal24h', 'Fatal (24 h)', fatalLast24h, 'VERIFIED', 'error_logs.level = FATAL', undefined),
    ],
    evidence: [
      {
        label: 'Error log',
        value: `${last24h} record(s) in 24 h`,
        source: 'error_logs',
        basis: 'VERIFIED',
      },
    ],
  };
}

export function orderPipelineHealth(snapshot: AiCeoSnapshot): DomainHealth {
  const counts = snapshot.orders.countsByStatus;
  const pendingPayment = counts.PENDING_PAYMENT ?? 0;
  const paymentFailed = counts.PAYMENT_FAILED ?? 0;
  const fulfilmentFailed = counts.FULFILMENT_FAILED ?? 0;
  const abandoned = snapshot.orders.pendingPaymentOlderThan24h;

  const now = snapshot.asOf;
  const stuck = snapshot.orders.window.filter((row) => {
    if (!OPEN_FULFILMENT_STATES.has(row.status)) return false;
    if (!row.paidAt) return false;
    const hours = ageHours(row.paidAt, now);
    return hours !== null && hours > THRESHOLDS.stuckFulfilmentDays * 24;
  });

  const levels: HealthLevel[] = ['OK'];
  const reasons: string[] = [];
  if (fulfilmentFailed > 0) {
    levels.push('ACTION');
    reasons.push(`${fulfilmentFailed} order(s) in FULFILMENT_FAILED`);
  }
  if (stuck.length > 0) {
    levels.push('ACTION');
    reasons.push(
      `${stuck.length} paid order(s) still open after ${THRESHOLDS.stuckFulfilmentDays} days`
    );
  }
  if (abandoned >= THRESHOLDS.abandonedPaymentsWarn) {
    levels.push('WATCH');
    reasons.push(`${abandoned} checkout(s) abandoned more than 24 h ago`);
  }
  if (paymentFailed > 0) {
    levels.push('WATCH');
    reasons.push(`${paymentFailed} order(s) with a failed payment`);
  }
  if (pendingPayment > 0) reasons.push(`${pendingPayment} order(s) awaiting payment`);
  if (reasons.length === 0) reasons.push('no order exceptions detected');

  return {
    id: 'orders',
    label: 'Order pipeline',
    level: worstLevel(levels),
    summary: reasons.join('; '),
    metrics: [
      countMetric('pendingPayment', 'Awaiting payment', pendingPayment, 'VERIFIED', 'orders.status = PENDING_PAYMENT', undefined),
      countMetric('paymentFailed', 'Payment failed', paymentFailed, 'VERIFIED', 'orders.status = PAYMENT_FAILED', undefined),
      countMetric('fulfilmentFailed', 'Fulfilment failed', fulfilmentFailed, 'VERIFIED', 'orders.status = FULFILMENT_FAILED', undefined),
      countMetric(
        'stuck',
        `Open > ${THRESHOLDS.stuckFulfilmentDays} days`,
        stuck.length,
        'DERIVED',
        'window orders with paidAt older than threshold and an open fulfilment status',
        'Derived from the rolling window only; an older order outside the window is not counted.'
      ),
      countMetric('abandoned', 'Abandoned > 24 h', abandoned, 'VERIFIED', 'orders.status = PENDING_PAYMENT and placedAt older than 24 h', undefined),
    ],
    evidence: [
      {
        label: 'Order status counts',
        value: Object.entries(counts)
          .filter(([, n]) => n > 0)
          .map(([status, n]) => `${status}: ${n}`)
          .join(' · ') || 'no orders',
        source: 'orders grouped by status',
        basis: 'VERIFIED',
      },
    ],
  };
}

export function paymentPostureHealth(snapshot: AiCeoSnapshot): DomainHealth {
  const { kind, isTest, environment } = snapshot.payments;
  let level: HealthLevel = 'OK';
  let summary = 'Live Razorpay configured';
  if (kind === 'NONE') {
    level = 'CRITICAL';
    summary = 'No payment provider is configured — the store cannot take money';
  } else if (kind === 'TEST' || isTest) {
    level = 'ACTION';
    summary = 'Test payment provider only — no real payment can be captured';
  }

  return {
    id: 'payments',
    label: 'Payments',
    level,
    summary: `${summary} (${environment})`,
    metrics: [
      countMetric('providerConfigured', 'Provider configured', kind === 'NONE' ? 0 : 1, 'VERIFIED', 'validated environment (RAZORPAY_* keys)', undefined),
      countMetric('liveMode', 'Live mode', kind === 'RAZORPAY' && !isTest ? 1 : 0, 'VERIFIED', 'payment provider resolution', undefined),
    ],
    evidence: [
      {
        label: 'Payment provider',
        value: `${kind}${isTest ? ' (test)' : ''}`,
        source: 'describePaymentProvider()',
        basis: 'VERIFIED',
      },
    ],
  };
}

export function supportHealth(snapshot: AiCeoSnapshot): DomainHealth {
  const open = snapshot.supportMessages.open;
  const refundsPending = snapshot.refunds.requested + snapshot.refunds.processing;
  const refundsFailed = snapshot.refunds.failed;
  const returnsOpen = snapshot.returns.open;

  const levels: HealthLevel[] = ['OK'];
  const reasons: string[] = [];
  if (refundsFailed > 0) {
    levels.push('ACTION');
    reasons.push(`${refundsFailed} refund(s) FAILED`);
  }
  if (refundsPending > 0) {
    levels.push('WATCH');
    reasons.push(`${refundsPending} refund(s) awaiting settlement`);
  }
  if (returnsOpen > 0) {
    levels.push('WATCH');
    reasons.push(`${returnsOpen} return request(s) open`);
  }
  if (open > 0) {
    levels.push('WATCH');
    reasons.push(`${open} support message(s) unresolved`);
  }
  if (reasons.length === 0) reasons.push('no unresolved customer items');

  return {
    id: 'customers',
    label: 'Customer commitments',
    level: worstLevel(levels),
    summary: reasons.join('; '),
    metrics: [
      countMetric('messagesOpen', 'Support messages open', open, 'VERIFIED', 'contact_messages.status = NEW', undefined),
      countMetric('returnsOpen', 'Returns open', returnsOpen, 'VERIFIED', 'return_requests.status in REQUESTED/APPROVED', undefined),
      countMetric('refundsPending', 'Refunds pending', refundsPending, 'VERIFIED', 'refunds.status in REQUESTED/PROCESSING', 'Money owed to a customer until settled.'),
      countMetric('refundsFailed', 'Refunds failed', refundsFailed, 'VERIFIED', 'refunds.status = FAILED', undefined),
    ],
    evidence: [
      {
        label: 'Customer commitments',
        value: `${open} message(s) · ${returnsOpen} return(s) · ${refundsPending + refundsFailed} refund(s)`,
        source: 'contact_messages, return_requests, refunds',
        basis: 'VERIFIED',
      },
    ],
  };
}

/** Risks derived from operational health — each carries its own evidence. */
export function operationalRisks(snapshot: AiCeoSnapshot, domains: DomainHealth[]): Risk[] {
  const risks: Risk[] = [];
  const domain = (id: string) => domains.find((d) => d.id === id);

  const payments = domain('payments');
  if (payments && (payments.level === 'CRITICAL' || payments.level === 'ACTION')) {
    risks.push({
      id: 'risk-payments',
      title: snapshot.payments.kind === 'NONE' ? 'Store cannot accept payments' : 'Only test payments are possible',
      severity: snapshot.payments.kind === 'NONE' ? 'CRITICAL' : 'HIGH',
      observation: payments.summary,
      evidence: payments.evidence,
      impact: 'No customer can complete a real purchase, so revenue cannot be validated.',
      blocksLaunch: true,
      adminHref: '/admin/settings',
    });
  }

  const jobs = domain('jobs');
  if (jobs && (jobs.level === 'ACTION' || jobs.level === 'CRITICAL')) {
    risks.push({
      id: 'risk-jobs',
      title: 'Background work is not completing',
      severity: 'HIGH',
      observation: jobs.summary,
      evidence: jobs.evidence,
      impact: 'Supplier orders and notifications can stall, leaving paid customers unfulfilled.',
      blocksLaunch: true,
      adminHref: '/admin/logs/jobs',
    });
  }

  const orders = domain('orders');
  if (orders && (orders.level === 'ACTION' || orders.level === 'CRITICAL')) {
    risks.push({
      id: 'risk-orders',
      title: 'Orders need manual intervention',
      severity: 'HIGH',
      observation: orders.summary,
      evidence: orders.evidence,
      impact: 'Customers who have paid may not receive their goods, which drives refunds and complaints.',
      blocksLaunch: false,
      adminHref: '/admin/orders',
    });
  }

  const customers = domain('customers');
  if (customers && snapshot.refunds.failed > 0) {
    risks.push({
      id: 'risk-refund-failures',
      title: 'Failed refunds owe customers money',
      severity: 'CRITICAL',
      observation: customers.summary,
      evidence: customers.evidence,
      impact: 'A failed refund is a financial liability and a consumer-protection complaint risk.',
      blocksLaunch: true,
      adminHref: '/admin/refunds',
    });
  }

  const errors = domain('errors');
  if (errors && (errors.level === 'ACTION' || errors.level === 'CRITICAL')) {
    risks.push({
      id: 'risk-errors',
      title: 'Elevated application errors',
      severity: errors.level === 'CRITICAL' ? 'CRITICAL' : 'MEDIUM',
      observation: errors.summary,
      evidence: errors.evidence,
      impact: 'Unhandled failures in checkout or fulfilment cause data loss the business cannot see from the storefront.',
      blocksLaunch: false,
      adminHref: '/admin/health',
    });
  }

  const webhooks = domain('webhooks');
  if (webhooks && webhooks.level === 'ACTION') {
    risks.push({
      id: 'risk-webhooks',
      title: 'Payment webhooks failed processing',
      severity: 'HIGH',
      observation: webhooks.summary,
      evidence: webhooks.evidence,
      impact: 'A paid order may never leave PENDING_PAYMENT, or a refund may not be recorded.',
      blocksLaunch: true,
      adminHref: '/admin/logs/webhooks',
    });
  }

  return risks;
}
