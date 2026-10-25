import type {
  AiCeoReport,
  AiCeoSnapshot,
  CatalogReport,
  DomainHealth,
  EvidenceItem,
  Recommendation,
  Risk,
  SalesReport,
  SupplierReport,
} from './contracts';
import { catalogHealth, computeCatalogReport, computeSupplierReport, DEFAULT_STALE_HOURS } from './catalog';
import { computeSalesReport } from './metrics';
import {
  errorHealth,
  jobQueueHealth,
  operationalRisks,
  orderPipelineHealth,
  paymentPostureHealth,
  supportHealth,
  webhookHealth,
  worstLevel,
} from './operations';
import { evaluateReadiness, readinessBlockers } from './readiness';

/**
 * The AI CEO reasoning engine.
 *
 * This is a deterministic, evidence-first report builder: no model is involved
 * in producing a figure, a risk or a recommendation. A configured model may
 * only *narrate* the finished report (see provider.ts), and that narrative is
 * labelled unverified.
 *
 * Decision process implemented for every recommendation:
 *  1 objective → 2 authorised data (snapshot only) → 3 freshness/completeness
 *  → 4 evidence → 5 uncertainty → 6 impact (only when measurable) → 7 safer
 *  alternative → 8 risk classification (mode) → 9 permission/approval
 *  → 11 verification method. Step 10/12 (execute + verify) happen only through
 *  the audited action endpoint, never inside this pure function.
 */

export interface BuildReportOptions {
  /** Stale-after threshold; defaults to the pipeline's 48 h. */
  staleAfterHours?: number;
  /** Cap on recommendations surfaced (default 12, newest/highest priority kept). */
  maxRecommendations?: number;
}

interface BuildContext {
  snapshot: AiCeoSnapshot;
  sales: SalesReport;
  catalog: CatalogReport;
  suppliers: SupplierReport;
  domains: DomainHealth[];
  risks: Risk[];
}

function evidence(label: string, value: string, source: string, basis: EvidenceItem['basis'] = 'VERIFIED'): EvidenceItem {
  return { label, value, source, basis };
}

function fmtInr(paise: number | null): string {
  if (paise === null) return 'not measurable';
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

function recommendations(ctx: BuildContext): Recommendation[] {
  const { snapshot, sales, catalog, suppliers, risks, domains } = ctx;
  const out: Recommendation[] = [];
  const domain = (id: string) => domains.find((d) => d.id === id);

  // 1. Payment readiness — highest priority, always an owner decision.
  const payments = domain('payments');
  if (payments && payments.level !== 'OK') {
    out.push({
      id: 'rec-payments',
      category: 'READINESS',
      objective: 'Be able to collect money from a real customer.',
      issue:
        snapshot.payments.kind === 'NONE'
          ? 'No payment provider is configured, so checkout cannot capture payment.'
          : 'Only a test payment provider is configured, so no real money can be captured.',
      evidence: payments.evidence,
      confidence: {
        level: 'HIGH',
        basis: 'Read directly from the validated environment (provider resolution), not inferred from traffic.',
      },
      expectedBenefit: null,
      risks: [
        'Switching to live keys before the provider account is fully verified can leave customers with a failed checkout.',
        'Live keys are refused outside production by the environment guard, so a preview deployment cannot test the live path.',
      ],
      proposedAction: {
        key: 'configure_live_payments',
        label: 'Configure and verify the live payment provider',
        mode: 'MODE_3_APPROVAL',
        executable: false,
        requiresApproval: true,
        description:
          'Owner action: complete provider KYC, add live keys to the production environment, then run one low-value real transaction and refund it.',
      },
      verification: 'describePaymentProvider() reports RAZORPAY (not test) in production, and one real payment appears with paymentStatus = PAID.',
      priority: 1,
    });
  }

  // 2. Failed refunds — money owed to a customer.
  if (snapshot.refunds.failed > 0) {
    out.push({
      id: 'rec-refunds-failed',
      category: 'COMMERCE',
      objective: 'Settle money already owed to customers.',
      issue: `${snapshot.refunds.failed} refund(s) are in FAILED state.`,
      evidence: [
        evidence('Refunds failed', String(snapshot.refunds.failed), 'refunds.status = FAILED'),
        evidence(
          'Refunds awaiting settlement',
          String(snapshot.refunds.requested + snapshot.refunds.processing),
          'refunds.status in REQUESTED/PROCESSING'
        ),
      ],
      confidence: { level: 'HIGH', basis: 'Row counts on the refunds table; no sampling.' },
      expectedBenefit: null,
      risks: [
        'Issuing a refund twice is a financial loss — never retry without checking the provider reference.',
        'The AI CEO is not permitted to move money; this is an owner/operations action.',
      ],
      proposedAction: {
        key: 'settle_failed_refunds',
        label: 'Investigate and settle failed refunds',
        mode: 'MODE_3_APPROVAL',
        executable: false,
        requiresApproval: true,
        description: 'Open Admin → Refunds, reconcile each failure with the provider, then settle or re-initiate manually.',
      },
      verification: 'refunds.failed returns to 0 and each order shows order.refundedTotal equal to the refunded amount.',
      priority: 1,
    });
  }

  // 3. Stalled background work.
  const jobs = domain('jobs');
  if (jobs && (jobs.level === 'ACTION' || jobs.level === 'CRITICAL')) {
    out.push({
      id: 'rec-jobs',
      category: 'OPERATIONS',
      objective: 'Ensure paid orders reach suppliers and customers are notified.',
      issue: jobs.summary,
      evidence: jobs.evidence,
      confidence: {
        level: 'HIGH',
        basis: 'Queue state and failure counts read from the jobs table.',
      },
      expectedBenefit:
        snapshot.jobs.failedLast24h > 0
          ? `${snapshot.jobs.failedLast24h} failed job(s) would be retried inside the existing attempt limit.`
          : null,
      risks: [
        'Processing the queue re-runs real side effects (supplier calls, e-mails); job dedupe keys prevent duplicates but a misconfigured supplier adapter can still fail again.',
        'A job that fails permanently must be fixed at source, not retried repeatedly.',
      ],
      proposedAction: {
        key: 'run_job_queue',
        label: 'Drain the due job queue now (max 25 jobs)',
        mode: 'MODE_2_EXECUTE',
        executable: true,
        requiresApproval: false,
        description:
          'Calls the existing, idempotent processDueJobs({ limit: 25 }) with a per-run cap. Requires owner-level permission; records an audit entry.',
      },
      verification: 'jobs.failedLast24h and the oldest PENDING age are re-read after the run; the audit log contains ai_ceo.action with the run result.',
      priority: 2,
    });
  }

  // 4. Catalogue freshness / quality.
  if (catalog.totalSupplierRows === 0) {
    out.push({
      id: 'rec-no-supplier-data',
      category: 'SUPPLIER',
      objective: 'Establish whether a supplier feed is actually connected.',
      issue: 'No supplier product row exists, so product automation has never ingested anything.',
      evidence: [
        evidence('Supplier products', '0', 'supplier_products'),
        evidence('Suppliers configured', String(suppliers.total), 'suppliers'),
      ],
      confidence: {
        level: 'HIGH',
        basis: 'Absence of rows is unambiguous; the cause (no sync run, no credentials, or no catalogue access) is not, and is not guessed.',
      },
      expectedBenefit: null,
      risks: [
        'A dry run against an unconfigured supplier will fail; the supplier adapter diagnostics should be checked first.',
        'Do not bypass provider rate limits or account permissions to force a catalogue.',
      ],
      proposedAction: {
        key: 'run_supplier_dry_run',
        label: 'Run a read-only supplier dry run',
        mode: 'MODE_2_EXECUTE',
        executable: true,
        requiresApproval: false,
        description:
          'Evaluates supplier rows with the real pipeline rules and writes nothing. Requires a configured, active supplier.',
      },
      verification: 'The dry-run response reports zero writes and the supplier_products count is unchanged (asserted by tests/integration/supplier-dry-run.test.ts).',
      priority: 3,
    });
  } else if (catalog.stale + catalog.neverSynced > 0) {
    out.push({
      id: 'rec-stale-catalogue',
      category: 'CATALOG',
      objective: 'Prevent selling stock the supplier no longer has.',
      issue: `${catalog.stale + catalog.neverSynced} of ${catalog.totalSupplierRows} supplier item(s) are outside the ${catalog.staleAfterHours} h freshness window (${catalog.stale} stale, ${catalog.neverSynced} never synced).`,
      evidence: [
        evidence('Stale supplier items', String(catalog.stale), `supplier_products.lastSyncedAt older than ${catalog.staleAfterHours} h`, 'DERIVED'),
        evidence('Never synced', String(catalog.neverSynced), 'supplier_products.lastSyncedAt is null'),
        evidence('Out of stock', String(catalog.outOfStock), 'supplier_products.inStock = false', 'VERIFIED'),
      ],
      confidence: {
        level: 'MEDIUM',
        basis: 'Freshness is computed from stored timestamps; whether the supplier itself is reachable is unknown until a sync runs.',
      },
      expectedBenefit:
        catalog.linkedActive > 0
          ? `${catalog.linkedActive} published product(s) depend on these supplier rows, so refreshing them protects those listings from overselling.`
          : null,
      risks: [
        'A sync can pause products if the supplier reports them unavailable — that is intended behaviour but is customer-visible.',
        'Supplier API rate limits and account permissions cannot be bypassed.',
      ],
      proposedAction: {
        key: 'run_supplier_dry_run',
        label: 'Preview a refresh with a dry run, then sync',
        mode: 'MODE_2_EXECUTE',
        executable: true,
        requiresApproval: false,
        description:
          'Dry run first (zero writes) to see what would change; the actual sync stays a separate admin action.',
      },
      verification: 'After the sync, supplier_products.lastSyncedAt moves inside the window and the lifecycle counts change consistently.',
      priority: 2,
    });
  }

  // 5. Drafts / unmapped rows waiting for a human.
  if (catalog.linkedDraft > 0 || catalog.unlinked > 0) {
    out.push({
      id: 'rec-mapping',
      category: 'CATALOG',
      objective: 'Turn discovered supplier items into deliberate, correct listings.',
      issue: `${catalog.linkedDraft} supplier item(s) are linked to DRAFT products and ${catalog.unlinked} are not linked to any product.`,
      evidence: [
        evidence('Linked drafts', String(catalog.linkedDraft), 'supplier_products.product.status = DRAFT'),
        evidence('Unlinked', String(catalog.unlinked), 'supplier_products.productId is null'),
        evidence('Missing cost', String(catalog.missingCost), 'supplier_products.supplierCost ≤ 0'),
      ],
      confidence: {
        level: 'HIGH',
        basis: 'Counts from stored rows. Sales potential is explicitly not claimed — no demand data is used.',
      },
      expectedBenefit: null,
      risks: [
        'Publishing an item with incomplete cost or image data produces a bad customer experience and an unknowable margin.',
        'Bulk publishing without review is exactly the failure mode auto-publish is disabled to avoid.',
      ],
      proposedAction: {
        key: 'review_drafts',
        label: 'Review drafts for publication',
        mode: 'MODE_1_RECOMMEND',
        executable: false,
        requiresApproval: true,
        description:
          'Open Admin → Product mapping, verify cost, stock evidence and imagery, then publish individually (owner approval required).',
      },
      verification: 'A published product appears as ACTIVE with a supplier link, a cost above zero and at least one image.',
      priority: 3,
    });
  }

  // 6. Money truthfulness: missing cost data.
  if (sales.paidOrderCount > 0 && sales.costCoverage < 0.999) {
    out.push({
      id: 'rec-cost-data',
      category: 'DATA',
      objective: 'Know whether the store actually makes money.',
      issue: `Costs are recorded for only ${Math.round(sales.costCoverage * 100)}% of realised revenue, so contribution is an upper bound rather than a measured result.`,
      evidence: sales.metrics
        .filter((m) => ['grossPaidRevenue', 'contribution', 'paidOrders'].includes(m.key))
        .map((m) => evidence(m.label, m.valuePaise !== null ? fmtInr(m.valuePaise) : String(m.valueCount ?? '—'), m.source, m.basis)),
      confidence: {
        level: 'HIGH',
        basis: 'Coverage is computed per order from the stored cost ledger; it does not depend on any assumption.',
      },
      expectedBenefit: null,
      risks: [
        'Reporting contribution as profit before costs are booked would overstate the business by the full supplier cost.',
        'Do not backfill cost fields with guesses — either take them from the supplier record or leave them empty.',
      ],
      proposedAction: {
        key: 'book_costs',
        label: 'Book supplier and gateway costs on orders',
        mode: 'MODE_1_RECOMMEND',
        executable: false,
        requiresApproval: false,
        description:
          'Record supplier invoices and actual gateway fees against orders; the profit ledger recomputes on every financial change.',
      },
      verification: 'costCoverage reaches 1.0 and the report basis for contribution changes from ESTIMATE to DERIVED.',
      priority: 3,
    });
  }

  // 7. Abandoned checkouts — observation only, no invented conversion claims.
  if (snapshot.orders.pendingPaymentOlderThan24h > 0) {
    out.push({
      id: 'rec-abandoned',
      category: 'COMMERCE',
      objective: 'Reduce lost checkouts without guessing at conversion behaviour.',
      issue: `${snapshot.orders.pendingPaymentOlderThan24h} order(s) have been waiting for payment for more than 24 hours.`,
      evidence: [
        evidence('Abandoned > 24 h', String(snapshot.orders.pendingPaymentOlderThan24h), 'orders.status = PENDING_PAYMENT and placedAt older than 24 h'),
        evidence('Payment failures', String(snapshot.orders.countsByStatus.PAYMENT_FAILED ?? 0), 'orders.status = PAYMENT_FAILED'),
      ],
      confidence: {
        level: 'MEDIUM',
        basis: 'The count is exact; the cause (customer intent, payment friction, provider error) is not observable from these records.',
      },
      expectedBenefit: null,
      risks: [
        'Automated reminder e-mails are a customer-visible action and require explicit approval.',
        'Recovering an abandoned payment must go through the payment provider — never mark it paid manually.',
      ],
      proposedAction: {
        key: 'inspect_checkout_failures',
        label: 'Inspect abandoned and failed payments',
        mode: 'MODE_1_RECOMMEND',
        executable: false,
        requiresApproval: false,
        description: 'Review Admin → Orders and the payment webhook log for a common failure before changing the checkout.',
      },
      verification: 'A subsequent 7-day window shows fewer aged pending-payment orders, measured with the same query.',
      priority: 4,
    });
  }

  // 8. Business identity / policy readiness.
  const readiness = evaluateReadiness({ snapshot });
  for (const blocker of readinessBlockers(readiness, 'LAUNCH')) {
    if (blocker.id === 'payments-configured' || blocker.id === 'payments-live' || blocker.id === 'catalogue') continue;
    out.push({
      id: `rec-readiness-${blocker.id}`,
      category: 'READINESS',
      objective: 'Be able to trade lawfully and be reachable by customers.',
      issue: `${blocker.label}: ${blocker.detail}`,
      evidence: [evidence(blocker.label, blocker.status, 'Settings / validated environment', 'VERIFIED')],
      confidence: {
        level: 'HIGH',
        basis: 'Presence/absence of configured values only. Whether the values satisfy a legal obligation is not assessed here.',
      },
      expectedBenefit: null,
      risks: blocker.needsProfessionalAdvice
        ? ['This item involves legal or tax obligations; the recommendation is to obtain professional advice, not that compliance has been achieved.']
        : ['Wrong configuration here is customer-visible on every page.'],
      proposedAction: {
        key: `owner_${blocker.id}`,
        label: blocker.ownerAction || 'Owner action required',
        mode: 'MODE_3_APPROVAL',
        executable: false,
        requiresApproval: true,
        description: blocker.detail,
      },
      verification: `The readiness item "${blocker.label}" changes from ${blocker.status} to PASS on this dashboard.`,
      priority: 2,
    });
  }

  // 9. Supplier sync failures.
  if (suppliers.failingSyncs.length > 0) {
    out.push({
      id: 'rec-supplier-failures',
      category: 'SUPPLIER',
      objective: 'Keep supplier synchronisation trustworthy.',
      issue: `${suppliers.failingSyncs.length} supplier(s) reported failed rows in their last sync.`,
      evidence: suppliers.failingSyncs.slice(0, 5).map((s) =>
        evidence(`${s.name} last sync`, `${s.status} — ${s.failed}/${s.total} failed`, 'settings.autoImport.syncReports')
      ),
      confidence: {
        level: 'HIGH',
        basis: 'Taken from the persisted sync report written by the sync itself.',
      },
      expectedBenefit: null,
      risks: [
        'Retrying a failing supplier without reading the error can trip rate limits or repeat a rejected payload.',
        'Supplier credentials and account permissions are owner-managed and cannot be repaired automatically.',
      ],
      proposedAction: {
        key: 'inspect_supplier',
        label: 'Run supplier diagnostics',
        mode: 'MODE_1_RECOMMEND',
        executable: false,
        requiresApproval: false,
        description: 'Open the supplier diagnostics panel to see the exact adapter error before retrying.',
      },
      verification: 'The next sync report for that supplier shows zero failed rows.',
      priority: 3,
    });
  }

  // 10. Evidence honesty when there is no trading history.
  if (sales.paidOrderCount === 0) {
    out.push({
      id: 'rec-no-sales-evidence',
      category: 'COMMERCE',
      objective: 'Avoid making growth decisions on absent data.',
      issue: 'No realised (paid) order exists inside the analysis window.',
      evidence: [
        evidence('Realised orders', '0', 'orders.paymentStatus = PAID*'),
        evidence('Window', `${sales.windowDays} days`, 'report configuration'),
      ],
      confidence: {
        level: 'HIGH',
        basis: 'The absence is verified. Demand, conversion and profitability cannot be inferred from it in any direction.',
      },
      expectedBenefit: null,
      risks: [
        'Treating zero sales as proof of a product or pricing problem is unsupported by the data.',
        'Discounting to generate a first sale would change customer-facing commercial terms and needs approval.',
      ],
      proposedAction: {
        key: 'observe_only',
        label: 'Keep observing; do not change pricing or catalogue on this evidence',
        mode: 'MODE_0_OBSERVE',
        executable: false,
        requiresApproval: false,
        description: 'Wait for real traffic and orders, then evaluate with the same verified queries.',
      },
      verification: 'Re-run this report after the first realised orders; the sales section stops reporting "not measurable".',
      priority: 5,
    });
  }

  // Risks that did not already produce a recommendation still deserve one.
  const covered = new Set(out.map((r) => r.id));
  for (const risk of risks) {
    const id = `rec-${risk.id}`;
    if (covered.has(id)) continue;
    out.push({
      id,
      category: 'OPERATIONS',
      objective: risk.impact,
      issue: risk.observation,
      evidence: risk.evidence,
      confidence: { level: 'HIGH', basis: 'Derived from persisted operational records.' },
      expectedBenefit: null,
      risks: ['The underlying cause is not identified by this report; inspect the linked admin screen first.'],
      proposedAction: {
        key: `inspect_${risk.id}`,
        label: risk.title,
        mode: 'MODE_1_RECOMMEND',
        executable: false,
        requiresApproval: false,
        description: risk.adminHref ? `Open ${risk.adminHref} to inspect the records.` : 'Inspect the underlying records.',
      },
      verification: 'The corresponding health surface returns to OK in a later report.',
      priority: risk.severity === 'CRITICAL' ? 1 : risk.severity === 'HIGH' ? 2 : 4,
    });
  }

  return out.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export function buildAiCeoReport(snapshot: AiCeoSnapshot, options: BuildReportOptions = {}): AiCeoReport {
  const staleAfterHours = options.staleAfterHours ?? DEFAULT_STALE_HOURS;
  const maxRecommendations = options.maxRecommendations ?? 12;

  const sales = computeSalesReport(snapshot.orders.window, snapshot.windowDays, snapshot.truncated);
  const catalog = computeCatalogReport(snapshot, staleAfterHours);
  const suppliers = computeSupplierReport(snapshot);

  const domains: DomainHealth[] = [
    paymentPostureHealth(snapshot),
    orderPipelineHealth(snapshot),
    jobQueueHealth(snapshot),
    webhookHealth(snapshot),
    errorHealth(snapshot),
    catalogHealth(snapshot, catalog),
    supportHealth(snapshot),
  ];

  const risks = [
    ...operationalRisks(snapshot, domains),
    ...catalogRisks(snapshot, catalog),
  ].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  const readiness = evaluateReadiness({ snapshot });
  const ctx: BuildContext = { snapshot, sales, catalog, suppliers, domains, risks };

  const allRecommendations = recommendations(ctx);
  const launchBlockers = readinessBlockers(readiness, 'LAUNCH');

  const dataGaps: string[] = [];
  if (snapshot.truncated) dataGaps.push('At least one query hit its row cap; totals are floors.');
  if (sales.paidOrderCount === 0) dataGaps.push('No realised order in the window: revenue, margin and demand are not measurable.');
  if (sales.paidOrderCount > 0 && sales.costCoverage < 0.999) dataGaps.push('Cost coverage is incomplete, so contribution is an upper bound.');
  if (catalog.totalSupplierRows === 0) dataGaps.push('No supplier catalogue data has been ingested.');
  if (!snapshot.automation.aiProviderConfigured) dataGaps.push('No model provider: the narrative section is disabled by design.');
  dataGaps.push('Fixed business overheads (salaries, rent, advertising) are not recorded in the database, so net profit is not measurable.');

  const headline = buildHeadline({ risks, launchBlockers: launchBlockers.length, sales, catalog });

  return {
    generatedAt: snapshot.asOf,
    windowDays: snapshot.windowDays,
    dataGaps,
    headline,
    overallLevel: worstLevel(domains.map((d) => d.level)),
    domains,
    sales,
    catalog,
    suppliers,
    risks,
    recommendations: allRecommendations.slice(0, maxRecommendations),
    readiness,
    modes: {
      observe: true,
      recommend: true,
      approvedLowRiskExecution:
        snapshot.automation.aiCeoEnabled && snapshot.automation.aiCeoActionsEnabled,
      authorisedBusinessOperations: false,
    },
    provider: {
      status: snapshot.automation.aiProviderConfigured ? 'CONFIGURED' : 'DISABLED',
      narrativeAvailable: snapshot.automation.aiProviderConfigured && snapshot.automation.aiCeoEnabled,
      reason: snapshot.automation.aiProviderConfigured
        ? 'A provider is configured. Narrative text is labelled unverified and never feeds back into a metric.'
        : 'No AI provider is configured. Every finding below is deterministic and computed from database records.',
    },
  };

  function buildHeadline(args: {
    risks: Risk[];
    launchBlockers: number;
    sales: SalesReport;
    catalog: CatalogReport;
  }): string {
    const critical = args.risks.filter((r) => r.severity === 'CRITICAL').length;
    const parts: string[] = [];
    if (critical > 0) parts.push(`${critical} critical risk${critical === 1 ? '' : 's'}`);
    if (args.launchBlockers > 0) parts.push(`${args.launchBlockers} launch blocker${args.launchBlockers === 1 ? '' : 's'}`);
    if (args.sales.paidOrderCount === 0) parts.push('no realised sales in the window');
    else parts.push(`${args.sales.paidOrderCount} realised order(s) in ${args.sales.windowDays} d`);
    if (args.catalog.totalSupplierRows === 0) parts.push('no supplier catalogue ingested');
    return parts.length > 0 ? parts.join(' · ') : 'Store state is healthy on every measurable surface.';
  }
}

function catalogRisks(snapshot: AiCeoSnapshot, catalog: CatalogReport): Risk[] {
  const risks: Risk[] = [];
  if (catalog.missingCost > 0) {
    risks.push({
      id: 'risk-catalog-cost',
      title: 'Supplier items without a cost cannot be priced',
      severity: 'MEDIUM',
      observation: `${catalog.missingCost} supplier item(s) have a supplier cost of zero or less.`,
      evidence: [
        evidence('Missing supplier cost', String(catalog.missingCost), 'supplier_products.supplierCost ≤ 0'),
      ],
      impact: 'Publishing these would set a price with no relation to the landed cost.',
      blocksLaunch: false,
      adminHref: '/admin/supplier-products',
    });
  }
  if (catalog.stale > 0 && catalog.linkedActive > 0) {
    risks.push({
      id: 'risk-oversell',
      title: 'Published listings may be based on stale supplier stock',
      severity: 'HIGH',
      observation: `${catalog.stale} stale supplier row(s) back ${catalog.linkedActive} published product(s).`,
      evidence: [
        evidence('Stale rows', String(catalog.stale), `lastSyncedAt older than ${catalog.staleAfterHours} h`, 'DERIVED'),
        evidence('Published products', String(catalog.linkedActive), 'supplier_products.product.status = ACTIVE'),
      ],
      impact: 'A customer can pay for an item the supplier can no longer ship, causing cancellations and refunds.',
      blocksLaunch: true,
      adminHref: '/admin/supplier-products',
    });
  }
  if ((snapshot.catalog.productCounts.ACTIVE ?? 0) === 0) {
    risks.push({
      id: 'risk-no-catalogue',
      title: 'Nothing is on sale',
      severity: 'CRITICAL',
      observation: 'No product has status ACTIVE.',
      evidence: [evidence('Published products', '0', 'products.status = ACTIVE')],
      impact: 'A storefront with no publishable product cannot generate revenue.',
      blocksLaunch: true,
      adminHref: '/admin/products',
    });
  }
  return risks;
}

function severityRank(severity: Risk['severity']): number {
  return { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }[severity];
}
