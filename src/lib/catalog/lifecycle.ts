import type { ProductEvaluationResult } from './ranking';
import { SUPPLIER_SYNC_FRESHNESS_HOURS } from './availability';

/**
 * Supplier-product lifecycle. Derived (not stored) from facts the system
 * already records — supplier feed flags, the import state written by the
 * pipeline, the catalogue product's status and sync freshness — so it can
 * never drift from reality and needs no migration.
 *
 *   DISCOVERED ─► IMPORTING ─► NEEDS_REVIEW ─► APPROVED ─► SCHEDULED ─► ACTIVE
 *        │            │              │                                  │
 *        ▼            ▼              ▼                                  ├─► STALE
 *  VALIDATION_FAILED  REJECTED   PAUSED (owner)                         └─► SUPPLIER_UNAVAILABLE
 */
export type SupplierProductLifecycleState =
  | 'DISCOVERED'
  | 'IMPORTING'
  | 'VALIDATION_FAILED'
  | 'NEEDS_REVIEW'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'STALE'
  | 'SUPPLIER_UNAVAILABLE'
  | 'PAUSED'
  | 'REJECTED';

export interface LifecycleInput {
  supplier: { isActive: boolean };
  supplierProduct: {
    isActive: boolean;
    /** null = supplier never reported availability (treated as unavailable). */
    inStock: boolean | null;
    stockQty: number | null;
    lastSyncedAt: Date | string | null;
    supplierCost: number | string | { toString(): string } | null;
    supplierSku: string | null;
  };
  /**
   * `publishAt` is a hook for a future scheduled-publish feature. The schema
   * has no such column today, so SCHEDULED is currently unreachable in
   * production data — it is kept so the vocabulary is complete and stable.
   */
  product: { status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | string; publishAt?: Date | null } | null;
  importState: { status: string; reasons?: string[] } | null;
  evaluation: Pick<
    ProductEvaluationResult,
    'eligibleForImport' | 'eligibleForAutoPublish' | 'blockingReasons' | 'publicationBlockers'
  > | null;
  now?: Date;
  staleAfterHours?: number;
}

export interface LifecycleResult {
  state: SupplierProductLifecycleState;
  /** One-line, owner-readable explanation of why this state applies. */
  reason: string;
  /** Hours since the last supplier sync, or null when never synced. */
  freshnessHours: number | null;
  isFresh: boolean;
  /** Whether the storefront may currently sell it (ACTIVE only). */
  sellable: boolean;
  /** What an owner/operator would do next. */
  nextAction: string;
}

function hoursSince(ts: Date | string | null, now: Date): number | null {
  if (!ts) return null;
  const t = typeof ts === 'string' ? new Date(ts).getTime() : ts.getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (now.getTime() - t) / 3600e3);
}

export function deriveLifecycleState(input: LifecycleInput): LifecycleResult {
  const now = input.now ?? new Date();
  const staleAfter = input.staleAfterHours ?? SUPPLIER_SYNC_FRESHNESS_HOURS;
  const freshnessHours = hoursSince(input.supplierProduct.lastSyncedAt, now);
  const isFresh = freshnessHours != null && freshnessHours <= staleAfter;
  const sp = input.supplierProduct;
  const product = input.product;
  const importStatus = input.importState?.status ?? null;
  const cost = sp.supplierCost == null ? 0 : Number(sp.supplierCost.toString());

  const done = (
    state: SupplierProductLifecycleState,
    reason: string,
    nextAction: string
  ): LifecycleResult => ({
    state,
    reason,
    freshnessHours: freshnessHours == null ? null : Math.round(freshnessHours * 10) / 10,
    isFresh,
    sellable: state === 'ACTIVE',
    nextAction,
  });

  // ── Operator / supplier-level holds take precedence ──────────────────────
  if (!input.supplier.isActive) {
    return done(
      'PAUSED',
      'Supplier is deactivated in Admin → Suppliers.',
      'Re-activate the supplier to resume syncing and selling its products.'
    );
  }
  if (!sp.isActive) {
    return done(
      'PAUSED',
      'Supplier product is paused (isActive=false) — either by an operator or because the supplier delisted it.',
      'Review the supplier listing; re-enable only if the supplier still offers it.'
    );
  }

  // ── Published products: health is about freshness and availability ───────
  if (product?.status === 'ACTIVE') {
    if (freshnessHours == null || !isFresh) {
      return done(
        'STALE',
        freshnessHours == null
          ? 'Published, but the supplier feed has never confirmed this item.'
          : `Published, but the last supplier sync was ${Math.round(freshnessHours)} h ago (limit ${staleAfter} h); the storefront already hides purchase actions for stale supplier stock.`,
        'Run a supplier sync. If the item stays stale, unpublish it.'
      );
    }
    if (!sp.inStock || (sp.stockQty != null && sp.stockQty <= 0)) {
      return done(
        'SUPPLIER_UNAVAILABLE',
        sp.inStock == null
          ? 'Supplier has never reported availability for this item; the storefront treats it as unavailable.'
          : 'Supplier currently reports no stock; the storefront shows it as unavailable.',
        'Keep monitoring; unpublish if it stays unavailable across several syncs.'
      );
    }
    return done('ACTIVE', 'Published, supplier stock confirmed within the freshness window.', 'None.');
  }

  if (product?.status === 'ARCHIVED') {
    return done(
      'PAUSED',
      'Catalogue product is archived.',
      'Restore the product to DRAFT if you intend to sell it again.'
    );
  }

  // ── Explicit rejection recorded by the pipeline or evaluator ─────────────
  if (importStatus === 'REJECTED' || (input.evaluation && !input.evaluation.eligibleForImport)) {
    const why =
      input.evaluation?.blockingReasons[0] ??
      input.importState?.reasons?.[0] ??
      'Failed an import gate (cost, compliance, shipping or completeness).';
    return done('REJECTED', why, 'Fix the underlying supplier data or leave rejected.');
  }

  // ── Not yet importable because of missing fundamentals ───────────────────
  if (!sp.supplierSku || cost <= 0) {
    return done(
      'VALIDATION_FAILED',
      !sp.supplierSku ? 'Supplier row has no SKU.' : 'Supplier row has no cost price.',
      'Cannot be priced or deduplicated; wait for a corrected supplier feed.'
    );
  }

  // ── Draft products in the catalogue ───────────────────────────────────────
  if (product?.status === 'DRAFT') {
    if (product.publishAt && product.publishAt.getTime() > now.getTime()) {
      return done(
        'SCHEDULED',
        `Publish scheduled for ${product.publishAt.toISOString()}.`,
        'Nothing — it will be published by the scheduler.'
      );
    }
    if (input.evaluation?.eligibleForAutoPublish) {
      return done(
        'APPROVED',
        'Imported as DRAFT and passes every quality gate. Automatic publishing is disabled, so an owner must publish it.',
        'Review the listing and publish from Admin → Products.'
      );
    }
    return done(
      'NEEDS_REVIEW',
      input.evaluation?.publicationBlockers[0] ??
        input.importState?.reasons?.[0] ??
        'Imported as DRAFT; at least one publication gate is not met.',
      'Resolve the blocker (images, description, shipping quote…) then publish.'
    );
  }

  // ── Not imported yet ──────────────────────────────────────────────────────
  if (importStatus === 'DRAFT' || importStatus === 'PUBLISHED') {
    // Pipeline recorded an import but the product row is gone/missing.
    return done(
      'IMPORTING',
      'Import was recorded but no catalogue product is linked — either the import is still running or the product was deleted.',
      'Re-run the import for this item; if the product was deleted intentionally, reject the supplier row.'
    );
  }
  if (importStatus === 'NEEDS_REVIEW' || (input.evaluation && !input.evaluation.eligibleForAutoPublish)) {
    return done(
      'NEEDS_REVIEW',
      input.evaluation?.publicationBlockers[0] ??
        input.importState?.reasons?.[0] ??
        'Evaluated; needs an operator decision before import.',
      'Inspect in Admin → Supplier products and import as draft or reject.'
    );
  }
  return done(
    'DISCOVERED',
    'Synced from the supplier feed; not yet imported.',
    'Evaluate / import as draft from Admin → Supplier products.'
  );
}

export const LIFECYCLE_LABELS: Record<SupplierProductLifecycleState, string> = {
  DISCOVERED: 'Discovered',
  IMPORTING: 'Importing',
  VALIDATION_FAILED: 'Validation failed',
  NEEDS_REVIEW: 'Needs review',
  APPROVED: 'Approved — awaiting publish',
  SCHEDULED: 'Scheduled',
  ACTIVE: 'Active',
  STALE: 'Stale',
  SUPPLIER_UNAVAILABLE: 'Supplier unavailable',
  PAUSED: 'Paused',
  REJECTED: 'Rejected',
};
