/**
 * Public availability model — ONE source of truth for what the storefront,
 * product page, cart and checkout are allowed to claim about stock.
 *
 * Why this exists: `StockMode.SUPPLIER_SYNC` is the default for supplier-
 * fulfilled products, and their real availability lives on the supplier
 * record (`SupplierProduct.inStock` / `stockQty`, refreshed by catalog sync).
 * `Product.stock` is a MERCHANT counter that no supplier feed writes, so
 * reading it for a supplier-synced product would advertise stock we cannot
 * verify. Equally, we must not invent an "out of stock" claim when the
 * supplier simply has not told us yet.
 *
 * The rules:
 *   LOCAL            → local counters are authoritative (unchanged behaviour).
 *   SUPPLIER_SYNC    → supplier data is authoritative ONLY while fresh.
 *                      Fresh + explicitly out of stock  → OUT_OF_STOCK.
 *                      Fresh + positively in stock      → IN_STOCK / LOW_STOCK.
 *                      Missing / stale / unknown data   → UNVERIFIED.
 *
 * `UNVERIFIED` never claims stock, never fabricates scarcity, and stays
 * purchasable (the supplier is checked again at fulfilment time) — while
 * `OUT_OF_STOCK` blocks purchase everywhere.
 */

export type AvailabilityState = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'UNVERIFIED';

/** How long a supplier catalog sync stays authoritative for availability. */
export const SUPPLIER_SYNC_FRESHNESS_HOURS = 48;

export interface AvailabilityInput {
  /** Product is only sellable when ACTIVE. */
  isActive: boolean;
  stockMode: 'LOCAL' | 'SUPPLIER_SYNC';
  /** Merchant-managed counter (used only by LOCAL). */
  stock: number;
  hasVariants: boolean;
  /** Active variants only. */
  variants: Array<{ stock: number }>;
  lowStockThreshold: number;
  /** Mapped supplier entry, when one exists. */
  supplier: SupplierAvailabilityInput | null;
  now?: Date;
  freshnessHours?: number;
}

export interface SupplierAvailabilityInput {
  inStock: boolean | null;
  stockQty: number | null;
  lastSyncedAt: Date | null;
}

export interface Availability {
  state: AvailabilityState;
  /** False only for a verified out-of-stock product. */
  purchasable: boolean;
  /** Hard cap for a single line, when the source knows one. Null = unknown. */
  maxQuantity: number | null;
  /** True when the state came from a fresh supplier report. */
  supplierVerified: boolean;
  /** ISO timestamp of the supplier report backing the state, when any. */
  verifiedAtIso: string | null;
  /** Customer-facing, non-fabricated label. */
  label: string;
}

function isFresh(
  lastSyncedAt: Date | null,
  now: Date,
  freshnessHours: number
): boolean {
  if (!lastSyncedAt) return false;
  const ageMs = now.getTime() - lastSyncedAt.getTime();
  // A sync timestamped in the future (clock skew) is still treated as fresh,
  // but an absurd future date is not: clamp to the freshness window.
  if (ageMs < 0) return ageMs > -freshnessHours * 3600e3;
  return ageMs <= freshnessHours * 3600e3;
}

function localQuantity(input: AvailabilityInput): number {
  if (!input.hasVariants) return Math.max(0, Math.trunc(input.stock));
  return input.variants.reduce((sum, v) => sum + Math.max(0, Math.trunc(v.stock)), 0);
}

export function resolveAvailability(input: AvailabilityInput): Availability {
  const now = input.now ?? new Date();
  const freshnessHours = input.freshnessHours ?? SUPPLIER_SYNC_FRESHNESS_HOURS;

  if (!input.isActive) {
    return {
      state: 'OUT_OF_STOCK',
      purchasable: false,
      maxQuantity: 0,
      supplierVerified: false,
      verifiedAtIso: null,
      label: 'Not available',
    };
  }

  if (input.stockMode === 'LOCAL') {
    const qty = localQuantity(input);
    if (qty <= 0) {
      return {
        state: 'OUT_OF_STOCK',
        purchasable: false,
        maxQuantity: 0,
        supplierVerified: false,
        verifiedAtIso: null,
        label: 'Sold out',
      };
    }
    if (input.lowStockThreshold > 0 && qty <= input.lowStockThreshold) {
      return {
        state: 'LOW_STOCK',
        purchasable: true,
        maxQuantity: qty,
        supplierVerified: false,
        verifiedAtIso: null,
        label: `Low stock — only ${qty} left`,
      };
    }
    return {
      state: 'IN_STOCK',
      purchasable: true,
      maxQuantity: qty,
      supplierVerified: false,
      verifiedAtIso: null,
      label: 'In stock',
    };
  }

  // --- SUPPLIER_SYNC -------------------------------------------------------
  const supplier = input.supplier;
  const fresh = supplier
    ? isFresh(supplier.lastSyncedAt, now, freshnessHours)
    : false;
  const verifiedAtIso = supplier?.lastSyncedAt?.toISOString() ?? null;

  if (!supplier || !fresh) {
    return {
      state: 'UNVERIFIED',
      purchasable: true,
      maxQuantity: null,
      supplierVerified: false,
      verifiedAtIso,
      label: 'Availability confirmed by our supplier at checkout',
    };
  }

  const reportedQty =
    supplier.stockQty != null && Number.isFinite(supplier.stockQty)
      ? Math.max(0, Math.trunc(supplier.stockQty))
      : null;
  const explicitlyOut =
    supplier.inStock === false || (reportedQty != null && reportedQty <= 0);
  const positivelyIn =
    supplier.inStock === true || (reportedQty != null && reportedQty > 0);

  if (explicitlyOut) {
    return {
      state: 'OUT_OF_STOCK',
      purchasable: false,
      maxQuantity: 0,
      supplierVerified: true,
      verifiedAtIso,
      label: 'Sold out',
    };
  }

  if (positivelyIn) {
    if (
      reportedQty != null &&
      input.lowStockThreshold > 0 &&
      reportedQty <= input.lowStockThreshold
    ) {
      return {
        state: 'LOW_STOCK',
        purchasable: true,
        maxQuantity: reportedQty,
        supplierVerified: true,
        verifiedAtIso,
        label: `Low stock — only ${reportedQty} left`,
      };
    }
    return {
      state: 'IN_STOCK',
      purchasable: true,
      maxQuantity: reportedQty,
      supplierVerified: true,
      verifiedAtIso,
      label: 'In stock',
    };
  }

  // Fresh sync, but the supplier reported neither a boolean nor a quantity.
  return {
    state: 'UNVERIFIED',
    purchasable: true,
    maxQuantity: null,
    supplierVerified: false,
    verifiedAtIso,
    label: 'Availability confirmed by our supplier at checkout',
  };
}

/** Cutoff used by storefront queries to filter on fresh supplier data. */
export function supplierFreshnessCutoff(
  now: Date = new Date(),
  freshnessHours: number = SUPPLIER_SYNC_FRESHNESS_HOURS
): Date {
  return new Date(now.getTime() - freshnessHours * 3600e3);
}

/** schema.org availability for structured data (undefined = omit, never fake). */
export function schemaAvailability(
  availability: Availability
): 'https://schema.org/InStock' | 'https://schema.org/OutOfStock' | undefined {
  if (availability.state === 'OUT_OF_STOCK') return 'https://schema.org/OutOfStock';
  if (availability.state === 'IN_STOCK' || availability.state === 'LOW_STOCK') {
    return 'https://schema.org/InStock';
  }
  return undefined;
}
