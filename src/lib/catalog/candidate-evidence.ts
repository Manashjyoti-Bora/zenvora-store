/**
 * Per-candidate evidence summary for supplier dry-run reports.
 *
 * Pure function: everything here is derived from data already stored on the
 * SupplierProduct row and the extracted metadata — nothing is fetched, nothing
 * is written, and no value is invented. Where evidence is missing the field
 * says so explicitly instead of defaulting to an optimistic value.
 */

export type EvidenceFreshness = 'FRESH' | 'STALE' | 'NEVER_SYNCED';
export type StockEvidence = 'SUPPLIER_REPORTED_QTY' | 'SUPPLIER_REPORTED_FLAG' | 'UNKNOWN';
export type CandidateConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface CandidateEvidence {
  source: {
    supplierName: string;
    supplierSlug: string;
    supplierType: string;
    externalId: string | null;
    supplierSku: string;
  };
  /** When the supplier row was last refreshed from the supplier (ISO) or null. */
  fetchedAt: string | null;
  ageHours: number | null;
  freshness: EvidenceFreshness;
  stock: {
    inStock: boolean | null;
    stockQty: number | null;
    evidence: StockEvidence;
  };
  cost: {
    supplierCostPaise: number | null;
    /** Cost is "verified" only when it is positive AND the row is fresh. */
    verified: boolean;
    shippingPaise: number | null;
    shippingKnown: boolean;
    currency: string;
  };
  completeness: {
    /** 0–100: share of the fields below that are present. */
    percent: number;
    present: string[];
    missing: string[];
  };
  /** Human-readable list of what is missing before this candidate can be trusted. */
  missingEvidence: string[];
  confidence: { level: CandidateConfidenceLevel; reason: string };
}

export interface CandidateEvidenceInput {
  supplier: { name: string; slug: string; type: string };
  supplierProduct: {
    supplierSku: string;
    externalId: string | null;
    supplierCost: number | string | { toString(): string };
    supplierShippingCost: number | string | { toString(): string } | null;
    currency: string;
    stockQty: number | null;
    inStock: boolean | null;
    lastSyncedAt: Date | null;
  };
  meta: {
    name: string;
    description: string | null;
    categoryName: string | null;
    images: string[];
    weightGrams: number | null;
    listedNum: number | null;
    shippingSupportedToIndia: boolean | null;
  };
  staleAfterHours: number;
  now?: Date;
}

const toPaise = (v: number | string | { toString(): string } | null): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(typeof v === 'object' ? v.toString() : v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

export function buildCandidateEvidence(input: CandidateEvidenceInput): CandidateEvidence {
  const now = input.now ?? new Date();
  const sp = input.supplierProduct;
  const meta = input.meta;

  const fetchedAt = sp.lastSyncedAt ? sp.lastSyncedAt.toISOString() : null;
  const ageHours = sp.lastSyncedAt
    ? Math.max(0, Math.round(((now.getTime() - sp.lastSyncedAt.getTime()) / 36e5) * 10) / 10)
    : null;
  const freshness: EvidenceFreshness =
    ageHours === null ? 'NEVER_SYNCED' : ageHours <= input.staleAfterHours ? 'FRESH' : 'STALE';

  const stockEvidence: StockEvidence =
    typeof sp.stockQty === 'number'
      ? 'SUPPLIER_REPORTED_QTY'
      : typeof sp.inStock === 'boolean'
        ? 'SUPPLIER_REPORTED_FLAG'
        : 'UNKNOWN';

  const supplierCostPaise = toPaise(sp.supplierCost);
  const shippingPaise = toPaise(sp.supplierShippingCost);
  const shippingKnown = sp.supplierShippingCost !== null && shippingPaise !== null;
  const costPositive = supplierCostPaise !== null && supplierCostPaise > 0;

  const fields: Array<[string, boolean]> = [
    ['name', meta.name.trim().length >= 4],
    ['description', Boolean(meta.description && meta.description.trim().length >= 20)],
    ['images', meta.images.length > 0],
    ['category', Boolean(meta.categoryName)],
    ['sku', sp.supplierSku.trim().length > 0],
    ['externalId', Boolean(sp.externalId)],
    ['cost', costPositive],
    ['shippingCost', shippingKnown],
    ['stock', stockEvidence !== 'UNKNOWN'],
    ['weight', typeof meta.weightGrams === 'number' && meta.weightGrams > 0],
    ['shipsToIndia', meta.shippingSupportedToIndia === true],
    ['demandSignal', typeof meta.listedNum === 'number'],
  ];
  const present = fields.filter(([, ok]) => ok).map(([k]) => k);
  const missing = fields.filter(([, ok]) => !ok).map(([k]) => k);
  const percent = Math.round((present.length / fields.length) * 100);

  const missingEvidence: string[] = [];
  if (freshness === 'NEVER_SYNCED') missingEvidence.push('Row has never been synced from the supplier; all values are unverified.');
  if (freshness === 'STALE')
    missingEvidence.push(`Last supplier sync is ${ageHours}h old (stale after ${input.staleAfterHours}h); price and stock need a refresh.`);
  if (!costPositive) missingEvidence.push('Supplier cost is missing or zero.');
  if (!shippingKnown) missingEvidence.push('Supplier shipping cost is not supplied; margin uses an estimate.');
  if (stockEvidence === 'UNKNOWN') missingEvidence.push('No stock quantity or availability flag from the supplier.');
  if (meta.shippingSupportedToIndia !== true) missingEvidence.push('Supplier has not confirmed shipping to India for this item.');
  if (meta.images.length === 0) missingEvidence.push('No product images.');
  if (!meta.description || meta.description.trim().length < 20) missingEvidence.push('No usable product description.');
  if (typeof meta.listedNum !== 'number') missingEvidence.push('No demand signal (listed count) from the supplier.');

  const costVerified = costPositive && freshness === 'FRESH';

  let level: CandidateConfidenceLevel;
  let reason: string;
  if (freshness !== 'FRESH' || !costPositive) {
    level = 'LOW';
    reason =
      freshness === 'NEVER_SYNCED'
        ? 'Never synced — nothing about this candidate has been verified against the supplier.'
        : !costPositive
          ? 'Supplier cost is missing, so no price or margin can be trusted.'
          : 'Supplier data is stale; verify price and stock before acting.';
  } else if (stockEvidence === 'UNKNOWN' || !shippingKnown || meta.shippingSupportedToIndia !== true) {
    level = 'MEDIUM';
    reason = 'Fresh cost, but stock, shipping cost or India shipping support is unconfirmed.';
  } else if (percent < 75) {
    level = 'MEDIUM';
    reason = `Fresh and priced, but listing data is only ${percent}% complete (${missing.join(', ')}).`;
  } else {
    level = 'HIGH';
    reason = `Fresh sync (${ageHours}h), supplier-reported stock, known shipping cost, ${percent}% complete listing.`;
  }

  return {
    source: {
      supplierName: input.supplier.name,
      supplierSlug: input.supplier.slug,
      supplierType: input.supplier.type,
      externalId: sp.externalId,
      supplierSku: sp.supplierSku,
    },
    fetchedAt,
    ageHours,
    freshness,
    stock: { inStock: sp.inStock, stockQty: sp.stockQty, evidence: stockEvidence },
    cost: {
      supplierCostPaise: costPositive ? supplierCostPaise : supplierCostPaise ?? null,
      verified: costVerified,
      shippingPaise: shippingKnown ? shippingPaise : null,
      shippingKnown,
      currency: sp.currency,
    },
    completeness: { percent, present, missing },
    missingEvidence,
    confidence: { level, reason },
  };
}
