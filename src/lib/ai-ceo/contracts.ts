/**
 * AI CEO — shared contracts.
 *
 * Everything in this folder that ends in `-pure` behaviour (metrics, health,
 * readiness, recommendations, tools, action policy) is a pure function over an
 * `AiCeoSnapshot`. Purity is a security property here, not a style preference:
 *
 *  - the snapshot is loaded ONCE by a single bounded database adapter
 *    (`snapshot.ts`), so no reasoning code can reach the database directly;
 *  - every number in the UI can be traced back to a field of this contract;
 *  - the whole intelligence layer is unit-testable with fixtures, with no
 *    database, no network and no model provider.
 *
 * Money is integer paise everywhere (see src/lib/money.ts). Nothing in this
 * contract carries personal data: no customer names, e-mails, phones or
 * addresses are part of the snapshot except aggregate counts.
 */

/** How a figure was obtained. Never present a lower level as a higher one. */
export type EvidenceBasis =
  /** Read directly from a persisted record or the validated environment. */
  | 'VERIFIED'
  /** Arithmetic over verified records (e.g. gross − refunds). No assumptions. */
  | 'DERIVED'
  /** Uses a configured assumption (fee %, reserve %). Not a measured outcome. */
  | 'ESTIMATE'
  /** Input data is missing or insufficient — the figure must not be shown as fact. */
  | 'UNKNOWN';

export const EVIDENCE_LABELS: Record<EvidenceBasis, string> = {
  VERIFIED: 'Verified',
  DERIVED: 'Derived',
  ESTIMATE: 'Estimate',
  UNKNOWN: 'Not measurable',
};

export type HealthLevel = 'OK' | 'WATCH' | 'ACTION' | 'CRITICAL' | 'UNKNOWN';

export const HEALTH_LABELS: Record<HealthLevel, string> = {
  OK: 'Healthy',
  WATCH: 'Watch',
  ACTION: 'Action required',
  CRITICAL: 'Critical',
  UNKNOWN: 'No data',
};

/** A single reported figure with its provenance. */
export interface Metric {
  key: string;
  label: string;
  /** Null means "not measurable from the data we hold" — never a silent zero. */
  valuePaise: number | null;
  valueCount: number | null;
  basis: EvidenceBasis;
  /** Where the figure comes from, in human terms (table/field or derivation). */
  source: string;
  /** Honest caveat shown next to the number when one exists. */
  note?: string;
}

// ---------------------------------------------------------------------------
// Snapshot: the only shape the reasoning layer is allowed to see
// ---------------------------------------------------------------------------

export interface OrderLedgerRow {
  id: string;
  status: string;
  paymentStatus: string;
  paymentMethod: 'PREPAID_GATEWAY' | 'COD';
  placedAt: string | null;
  paidAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  /** All amounts are integer paise, converted at the database boundary. */
  grandTotalPaise: number;
  subtotalPaise: number;
  discountTotalPaise: number;
  shippingTotalPaise: number;
  taxTotalPaise: number;
  supplierCostTotalPaise: number;
  shippingCostTotalPaise: number;
  paymentFeeTotalPaise: number;
  otherCostTotalPaise: number;
  refundedTotalPaise: number;
  estimatedProfitPaise: number;
  actualProfitPaise: number;
  profitFinalizedAt: string | null;
}

export interface SupplierProductRow {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierActive: boolean;
  supplierCostPaise: number;
  supplierShippingPaise: number | null;
  inStock: boolean | null;
  stockQty: number | null;
  lastSyncedAt: string | null;
  linkedProductStatus: string | null;
}

export interface SupplierSyncSummary {
  at: string | null;
  status: string;
  failed: number;
  total: number;
}

export interface AiCeoSnapshot {
  /** Snapshot creation time (ISO). All "age" calculations are relative to this. */
  asOf: string;
  /** Rolling window used for sales/order analysis, in days. */
  windowDays: number;
  /** True when a query hit its row cap; every derived figure must be flagged. */
  truncated: boolean;

  store: {
    name: string;
    demoMode: boolean;
    supportEmailConfigured: boolean;
    supportPhoneConfigured: boolean;
    /** legalName + address + GSTIN completeness, as recorded in Settings. */
    businessIdentity: 'COMPLETE' | 'PARTIAL' | 'MISSING';
  };

  payments: {
    kind: 'RAZORPAY' | 'TEST' | 'NONE';
    /** True when the configured provider is a test/dev-only provider. */
    isTest: boolean;
    environment: string;
  };

  automation: {
    autoPublishEligible: boolean;
    supplierLiveOrderingEnabled: boolean;
    cronSecretConfigured: boolean;
    /** True only when an AI provider is configured AND enabled. */
    aiProviderConfigured: boolean;
    /** Kill switch state read from Settings.aiCeo. */
    aiCeoEnabled: boolean;
    aiCeoActionsEnabled: boolean;
  };

  orders: {
    /** Orders with a placed date inside the window (bounded). */
    window: OrderLedgerRow[];
    /** Counts of ALL orders by current status (not window-limited). */
    countsByStatus: Record<string, number>;
    /** `PENDING_PAYMENT` older than 24 h — abandoned checkout signal. */
    pendingPaymentOlderThan24h: number;
    /** Orders whose fulfilment status is not PENDING/DELIVERED, window rows. */
    windowCount: number;
  };

  refunds: { requested: number; processing: number; completed: number; failed: number };
  returns: { open: number };
  supportMessages: { open: number };

  jobs: {
    counts: Record<string, number>;
    failedLast24h: number;
    oldestPendingAt: string | null;
    oldestPendingType: string | null;
  };

  webhooks: { last24hByStatus: Record<string, number> };

  errors: { last24h: number; fatalLast24h: number };

  suppliers: {
    total: number;
    inactive: number;
    /** Bounded sample of supplier product rows used for catalogue analysis. */
    rows: SupplierProductRow[];
    syncBySupplier: Record<string, SupplierSyncSummary>;
  };

  catalog: {
    productCounts: Record<string, number>;
    /** ACTIVE products with no supplier link — manual stock/fulfilment only. */
    activeWithoutSupplierLink: number;
    /** ACTIVE products with no image — cannot be merchandised. */
    activeWithoutImage: number;
  };

  audit: { lastAction: string | null; lastAt: string | null };

  /**
   * The SHARED launch-readiness list used by Admin → Health and Admin →
   * Operations (`src/lib/ops/launch-blockers.ts`), passed through unchanged so
   * the AI CEO can never disagree with those pages. The typed `readiness[]`
   * below adds owner actions on top; it does not replace this list.
   */
  sharedReadiness: { blockers: string[]; configGaps: string[] };
}

// ---------------------------------------------------------------------------
// Findings, risks, recommendations
// ---------------------------------------------------------------------------

export interface EvidenceItem {
  label: string;
  value: string;
  /** Which part of the snapshot produced it. */
  source: string;
  basis: EvidenceBasis;
}

/** Confidence is a stated basis, never a pseudo-statistical score. */
export interface Confidence {
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  basis: string;
}

export type RiskSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface Risk {
  id: string;
  title: string;
  severity: RiskSeverity;
  /** What is happening, in one sentence, without interpretation. */
  observation: string;
  evidence: EvidenceItem[];
  /** What breaks for the business if this is ignored. */
  impact: string;
  /** True when this risk must be cleared before taking real money. */
  blocksLaunch: boolean;
  /** Deep link into the existing admin screen that resolves it, when one exists. */
  adminHref?: string;
}

export type RecommendationMode = 'MODE_0_OBSERVE' | 'MODE_1_RECOMMEND' | 'MODE_2_EXECUTE' | 'MODE_3_APPROVAL';

export interface ProposedAction {
  key: string;
  label: string;
  mode: RecommendationMode;
  /** Catalogue action executable by the AI CEO endpoints (Mode 2 only). */
  executable: boolean;
  /** Human action required first (Mode 3) — always an owner decision. */
  requiresApproval: boolean;
  description: string;
}

export interface Recommendation {
  id: string;
  category: 'OPERATIONS' | 'CATALOG' | 'SUPPLIER' | 'COMMERCE' | 'READINESS' | 'DATA';
  /** Stage 1 of the decision process: what business objective does this serve? */
  objective: string;
  /** Stage 4: the observed issue, stated as fact. */
  issue: string;
  evidence: EvidenceItem[];
  confidence: Confidence;
  /** Stage 6: impact is only stated when the evidence supports it. */
  expectedBenefit: string | null;
  /** Stage 5: uncertainty and failure modes. */
  risks: string[];
  /** Stage 8/9: risk classification + permission requirement. */
  proposedAction: ProposedAction;
  /** Stage 11: how the result would be verified. */
  verification: string;
  priority: 1 | 2 | 3 | 4 | 5;
}

export interface ReadinessItem {
  id: string;
  label: string;
  status: 'PASS' | 'ACTION_REQUIRED' | 'NOT_CONFIGURED' | 'OWNER_DECISION' | 'UNKNOWN';
  detail: string;
  /** What exactly the owner has to do. Empty when status is PASS. */
  ownerAction: string;
  blocks: Array<'TESTING' | 'DEMO' | 'LAUNCH'>;
  /** True when this item needs qualified professional advice (legal/tax). */
  needsProfessionalAdvice?: boolean;
}

export interface DomainHealth {
  id: string;
  label: string;
  level: HealthLevel;
  /** One-line factual summary. */
  summary: string;
  metrics: Metric[];
  evidence: EvidenceItem[];
}

export interface SalesReport {
  windowDays: number;
  paidOrderCount: number;
  committedCodOrderCount: number;
  cancelledOrderCount: number;
  grossPaidRevenuePaise: number;
  refundedPaise: number;
  netRevenuePaise: number;
  discountPaise: number;
  supplierCostPaise: number;
  shippingCostPaise: number;
  paymentFeePaise: number;
  otherCostPaise: number;
  contributionPaise: number | null;
  contributionMarginPercent: number | null;
  averageOrderValuePaise: number | null;
  /** Share of realised revenue whose orders have any cost booked (0–1). */
  costCoverage: number;
  /** Orders in the window that recorded at least one cost component. */
  ordersWithCosts: number;
  basis: EvidenceBasis;
  caveats: string[];
  metrics: Metric[];
}

export interface CatalogReport {
  totalSupplierRows: number;
  evaluated: number;
  inStock: number;
  outOfStock: number;
  unknownStock: number;
  stale: number;
  neverSynced: number;
  missingShippingCost: number;
  missingCost: number;
  linkedActive: number;
  linkedDraft: number;
  unlinked: number;
  staleAfterHours: number;
  metrics: Metric[];
}

export interface SupplierReport {
  total: number;
  inactive: number;
  withRows: number;
  failingSyncs: Array<{ supplierId: string; name: string; status: string; failed: number; total: number; at: string | null }>;
  staleSuppliers: Array<{ supplierId: string; name: string; lastSyncAt: string | null }>;
  metrics: Metric[];
}

export interface AiCeoReport {
  /** Snapshot time — the report is a deterministic function of this snapshot. */
  generatedAt: string;
  windowDays: number;
  /** Honest statement about the completeness of the inputs. */
  dataGaps: string[];
  headline: string;
  overallLevel: HealthLevel;
  domains: DomainHealth[];
  sales: SalesReport;
  catalog: CatalogReport;
  suppliers: SupplierReport;
  risks: Risk[];
  recommendations: Recommendation[];
  readiness: ReadinessItem[];
  /** Canonical shared list (Health/Operations) — identical strings, no re-derivation. */
  readinessShared: { blockers: string[]; configGaps: string[]; source: string };
  /** Modes available to this deployment right now. */
  modes: {
    observe: true;
    recommend: true;
    approvedLowRiskExecution: boolean;
    authorisedBusinessOperations: false;
  };
  provider: {
    status: 'DISABLED' | 'CONFIGURED';
    narrativeAvailable: boolean;
    reason: string;
  };
}
