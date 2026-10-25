import type { AiCeoSnapshot, CatalogReport, DomainHealth, HealthLevel, SupplierReport } from './contracts';
import { ageHours, worstLevel } from './operations';
import { countMetric } from './metrics';

/**
 * Catalogue and supplier intelligence computed from supplier rows already in
 * the snapshot. No demand, review or "will sell" claims are made: only
 * observable data quality and freshness.
 */

export const DEFAULT_STALE_HOURS = 48;

export function computeCatalogReport(snapshot: AiCeoSnapshot, staleAfterHours = DEFAULT_STALE_HOURS): CatalogReport {
  const rows = snapshot.suppliers.rows;
  let inStock = 0;
  let outOfStock = 0;
  let unknownStock = 0;
  let stale = 0;
  let neverSynced = 0;
  let missingShippingCost = 0;
  let linkedActive = 0;
  let linkedDraft = 0;
  let unlinked = 0;
  let missingCost = 0;

  for (const row of rows) {
    if (row.inStock === true && (row.stockQty === null || row.stockQty > 0)) inStock += 1;
    else if (row.inStock === false || (row.stockQty !== null && row.stockQty <= 0)) outOfStock += 1;
    else unknownStock += 1;

    const age = ageHours(row.lastSyncedAt, snapshot.asOf);
    if (age === null) neverSynced += 1;
    else if (age > staleAfterHours) stale += 1;

    if (row.supplierShippingPaise === null) missingShippingCost += 1;
    if (row.supplierCostPaise <= 0) missingCost += 1;

    if (row.linkedProductStatus === 'ACTIVE') linkedActive += 1;
    else if (row.linkedProductStatus === 'DRAFT') linkedDraft += 1;
    else if (row.linkedProductStatus === null) unlinked += 1;
  }

  const metrics = [
    countMetric('supplierRows', 'Discovered supplier items', rows.length, 'VERIFIED', 'supplier_products (bounded sample)', snapshot.truncated ? 'Sample capped — totals are a floor.' : undefined),
    countMetric('inStock', 'In stock (supplier-reported)', inStock, 'VERIFIED', 'supplier_products.inStock / stockQty', undefined),
    countMetric('outOfStock', 'Out of stock', outOfStock, 'VERIFIED', 'supplier_products.inStock = false or stockQty ≤ 0', undefined),
    countMetric('unknownStock', 'Stock unknown', unknownStock, 'VERIFIED', 'supplier_products.inStock is null', 'A null stock flag is not evidence of availability.'),
    countMetric('stale', 'Stale (older than threshold)', stale, 'DERIVED', `lastSyncedAt older than ${staleAfterHours} h`, undefined),
    countMetric('neverSynced', 'Never synced', neverSynced, 'VERIFIED', 'supplier_products.lastSyncedAt is null', undefined),
    countMetric('missingShippingCost', 'Missing shipping cost', missingShippingCost, 'VERIFIED', 'supplier_products.supplierShippingCost is null', 'Landed cost is incomplete, so margin is an upper bound.'),
    countMetric('missingCost', 'Missing supplier cost', missingCost, 'VERIFIED', 'supplier_products.supplierCost ≤ 0', 'Cannot be priced or published.'),
    countMetric('linkedActive', 'Linked to ACTIVE product', linkedActive, 'VERIFIED', 'supplier_products.product.status = ACTIVE', undefined),
    countMetric('linkedDraft', 'Linked to DRAFT product', linkedDraft, 'VERIFIED', 'supplier_products.product.status = DRAFT', undefined),
    countMetric('unlinked', 'Not linked to a product', unlinked, 'VERIFIED', 'supplier_products.productId is null', undefined),
  ];

  return {
    totalSupplierRows: rows.length,
    evaluated: inStock + outOfStock + unknownStock,
    inStock,
    outOfStock,
    unknownStock,
    stale,
    neverSynced,
    missingShippingCost,
    missingCost,
    linkedActive,
    linkedDraft,
    unlinked,
    staleAfterHours,
    metrics,
  };
}

export function catalogHealth(snapshot: AiCeoSnapshot, report: CatalogReport): DomainHealth {
  const productCounts = snapshot.catalog.productCounts;
  const active = productCounts.ACTIVE ?? 0;
  const draft = productCounts.DRAFT ?? 0;
  const archived = productCounts.ARCHIVED ?? 0;

  const levels: HealthLevel[] = ['OK'];
  const reasons: string[] = [];

  if (active === 0) {
    levels.push('ACTION');
    reasons.push('no product is published, so the storefront has nothing to sell');
  }
  if (report.totalSupplierRows > 0 && report.stale + report.neverSynced === report.totalSupplierRows) {
    levels.push('ACTION');
    reasons.push('no supplier row has been synced inside the freshness window');
  } else if (report.stale + report.neverSynced > 0) {
    levels.push('WATCH');
    reasons.push(`${report.stale + report.neverSynced} supplier item(s) outside the ${report.staleAfterHours} h freshness window`);
  }
  if (report.missingCost > 0) {
    levels.push('WATCH');
    reasons.push(`${report.missingCost} supplier item(s) have no cost and cannot be priced`);
  }
  if (snapshot.catalog.activeWithoutImage > 0) {
    levels.push('WATCH');
    reasons.push(`${snapshot.catalog.activeWithoutImage} published product(s) have no image`);
  }
  if (reasons.length === 0) reasons.push('catalogue data is complete and fresh');

  return {
    id: 'catalog',
    label: 'Catalogue quality',
    level: worstLevel(levels),
    summary: reasons.join('; '),
    metrics: [
      countMetric('activeProducts', 'Published products', active, 'VERIFIED', 'products.status = ACTIVE', undefined),
      countMetric('draftProducts', 'Draft products', draft, 'VERIFIED', 'products.status = DRAFT', undefined),
      countMetric('archivedProducts', 'Archived products', archived, 'VERIFIED', 'products.status = ARCHIVED', undefined),
      countMetric('activeNoSupplier', 'Published without supplier link', snapshot.catalog.activeWithoutSupplierLink, 'VERIFIED', 'products.status = ACTIVE and no supplier_products row', 'Fulfilment for these depends on manual stock.'),
      ...report.metrics,
    ],
    evidence: [
      {
        label: 'Catalogue composition',
        value: `ACTIVE ${active} · DRAFT ${draft} · ARCHIVED ${archived}`,
        source: 'products grouped by status',
        basis: 'VERIFIED',
      },
    ],
  };
}

export function computeSupplierReport(snapshot: AiCeoSnapshot): SupplierReport {
  const failing: SupplierReport['failingSyncs'] = [];
  const stale: SupplierReport['staleSuppliers'] = [];
  let withRows = 0;

  const rowsBySupplier = new Map<string, number>();
  for (const row of snapshot.suppliers.rows) {
    rowsBySupplier.set(row.supplierId, (rowsBySupplier.get(row.supplierId) ?? 0) + 1);
  }

  for (const [supplierId, summary] of Object.entries(snapshot.suppliers.syncBySupplier)) {
    if (summary.failed > 0 || summary.status === 'FAILED' || summary.status === 'PARTIAL_FAILURE') {
      failing.push({
        supplierId,
        name: snapshot.suppliers.rows.find((r) => r.supplierId === supplierId)?.supplierName ?? supplierId,
        status: summary.status,
        failed: summary.failed,
        total: summary.total,
        at: summary.at,
      });
    }
    const age = ageHours(summary.at, snapshot.asOf);
    if (summary.at === null || (age !== null && age > 24 * 7)) {
      stale.push({
        supplierId,
        name: snapshot.suppliers.rows.find((r) => r.supplierId === supplierId)?.supplierName ?? supplierId,
        lastSyncAt: summary.at,
      });
    }
  }
  for (const supplierId of rowsBySupplier.keys()) {
    if (!snapshot.suppliers.syncBySupplier[supplierId]) withRows += 1;
  }

  return {
    total: snapshot.suppliers.total,
    inactive: snapshot.suppliers.inactive,
    withRows,
    failingSyncs: failing,
    staleSuppliers: stale,
    metrics: [
      countMetric('suppliers', 'Suppliers configured', snapshot.suppliers.total, 'VERIFIED', 'suppliers', undefined),
      countMetric('inactiveSuppliers', 'Inactive suppliers', snapshot.suppliers.inactive, 'VERIFIED', 'suppliers.isActive = false', undefined),
      countMetric('failingSuppliers', 'Suppliers with failed rows', failing.length, 'DERIVED', 'last sync report totals', undefined),
      countMetric('staleSuppliers', 'Suppliers not synced in 7 days', stale.length, 'DERIVED', 'last sync report timestamp', undefined),
      countMetric('unreportedSuppliers', 'Suppliers with rows but no sync report', withRows, 'VERIFIED', 'sync reports are stored in settings.autoImport.syncReports', undefined),
    ],
  };
}
