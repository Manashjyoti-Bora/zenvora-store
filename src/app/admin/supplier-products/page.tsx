import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { formatINR } from '@/lib/money';
import {
  evaluateSupplierProductCandidate,
  getAllSupplierSyncReports,
} from '@/lib/catalog/auto-import';
import { getFulfilmentReadinessReport } from '@/lib/catalog/fulfilment-readiness';
import { getCatalogPipelineCounts } from '@/lib/catalog/diagnostics';
import {
  SupplierProductMapper,
  type SupplierProductRow,
} from '@/components/admin/supplier-product-mapper';
import { SupplierCatalogOps } from '@/components/admin/supplier-catalog-ops';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Supplier product discovery & mapping — Admin',
  robots: { index: false },
};

export default async function SupplierProductsPage() {
  const [
    supplierProducts,
    products,
    suppliers,
    settings,
    activeRules,
    syncReports,
    readiness,
    pipelineCounts,
  ] = await Promise.all([
    prisma.supplierProduct.findMany({
      orderBy: [{ productId: 'asc' }, { updatedAt: 'desc' }],
      take: 500,
      include: {
        supplier: true,
        product: { select: { id: true, name: true, slug: true, status: true } },
      },
    }),
    prisma.product.findMany({
      where: { status: { not: 'ARCHIVED' } },
      orderBy: { name: 'asc' },
      take: 500,
      select: { id: true, name: true, supplierSku: true, status: true },
    }),
    prisma.supplier.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, type: true, isActive: true },
    }),
    getSettings(),
    prisma.pricingRule.findMany({ where: { isActive: true } }),
    getAllSupplierSyncReports(),
    getFulfilmentReadinessReport({ includeDrafts: true }),
    getCatalogPipelineCounts(),
  ]);

  const tierCounts = {
    HIGH_POTENTIAL: 0,
    PROMISING: 0,
    NEEDS_REVIEW: 0,
    NOT_ELIGIBLE: 0,
  };

  const rows: SupplierProductRow[] = supplierProducts.map((sp) => {
    const { meta, pricing, evaluation } = evaluateSupplierProductCandidate({
      sp,
      settings,
      activeRules,
    });
    tierCounts[evaluation.tier] += 1;

    return {
      id: sp.id,
      supplierId: sp.supplierId,
      supplierName: sp.supplier.name,
      supplierSku: sp.supplierSku,
      externalId: sp.externalId,
      supplierCost: Number(sp.supplierCost),
      supplierShippingCost:
        sp.supplierShippingCost != null ? Number(sp.supplierShippingCost) : null,
      stockQty: sp.stockQty,
      inStock: sp.inStock,
      isActive: sp.isActive,
      lastSyncedAt: sp.lastSyncedAt?.toISOString() ?? null,
      productId: sp.productId,
      productName: sp.product?.name ?? null,
      productSlug: sp.product?.slug ?? null,
      productStatus: sp.product?.status ?? null,
      candidateTitle: meta.name,
      categoryName: meta.categoryName,
      imageCount: meta.images.length,
      tier: evaluation.tier,
      score: evaluation.score,
      demandConfidence: evaluation.demandConfidence,
      codSuitable: evaluation.codSuitable,
      eligibleForAutoPublish: evaluation.eligibleForAutoPublish,
      estimatedSellingPriceRupees: Math.round(pricing.sellingPricePaise / 100),
      effectiveMarginPercent: pricing.effectiveMarginPercent,
      summary: evaluation.summary,
      blockingReasons: evaluation.blockingReasons,
      publicationBlockers: evaluation.publicationBlockers,
      factors: evaluation.factors,
      fieldSources: meta.fieldSources,
    };
  });

  const publishedCount = pipelineCounts.products.storefrontEligible;
  const draftCount = pipelineCounts.products.draft;
  const latestReport = syncReports[0] ?? null;
  const notReadySellable = readiness.items.filter((i) => i.status === 'ACTIVE' && !i.ready);
  const marginAlerts = readiness.items.filter((i) => i.marginAlert);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Catalog Pipeline &amp; Eligibility Engine</p>
          <h1>Supplier product discovery, ranking &amp; mapping</h1>
          <p className="mt-1 text-sm text-ink-500">
            Every discovered CJ / supplier product is evaluated for Indian reselling viability
            (landed cost, gross margin, India shipping, stock, images, compliance, and COD fit).
          </p>
        </div>
        <div className="rounded-xl border border-ink-900/10 bg-cream-50 px-3.5 py-2 text-xs text-ink-700">
          <span className="font-semibold">Ordering Safety Mode:</span>{' '}
          {readiness.safetyMode.statusLabel}
        </div>
      </header>

      {/* Pipeline Summary KPIs. Persistent counts use whole-table aggregates;
          rank tiers are recalculated only for the supplier rows loaded below. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <div className="card p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            Supplier records stored
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums text-ink-900">
            {pipelineCounts.supplierProducts.total}
          </p>
        </div>
        <div className="card border-emerald-200 bg-emerald-50/40 p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800">
            High potential · loaded
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums text-emerald-900">
            {tierCounts.HIGH_POTENTIAL}
          </p>
        </div>
        <div className="card border-blue-200 bg-blue-50/40 p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-800">
            Promising · loaded
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums text-blue-900">
            {tierCounts.PROMISING}
          </p>
        </div>
        <div className="card border-amber-200 bg-amber-50/40 p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-800">
            Import state · needs review
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums text-amber-900">
            {pipelineCounts.supplierProducts.needsReview}
          </p>
        </div>
        <div className="card border-red-200 bg-red-50/40 p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-red-800">
            Import state · rejected
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums text-red-900">
            {pipelineCounts.supplierProducts.rejected}
          </p>
        </div>
        <div className="card p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            Storefront eligible
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums text-ink-900">{publishedCount}</p>
        </div>
        <div className="card p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            Products in draft
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums text-ink-900">{draftCount}</p>
        </div>
      </div>
      <p className="-mt-4 text-xs text-ink-400">
        Database totals cover every row. Current rules flag {tierCounts.NEEDS_REVIEW} of the
        up-to-500 loaded supplier records for review and {tierCounts.NOT_ELIGIBLE} as ineligible;
        these are not whole-database counts.
      </p>

      <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="catalog-diagnostics-title">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="catalog-diagnostics-title" className="text-base font-bold text-ink-900">
              Storefront eligibility &amp; catalogue diagnostics
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">
              The public shop uses the same rule as the sitemap: product status must be ACTIVE and
              the stored selling price must be above ₹0.
            </p>
          </div>
          <Badge tone={publishedCount > 0 ? 'green' : 'amber'}>
            {publishedCount} eligible for /shop
          </Badge>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-lg bg-cream-50 p-3">
            <dt className="text-ink-500">All catalogue products</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums text-ink-900">
              {pipelineCounts.products.total}
            </dd>
          </div>
          <div className="rounded-lg bg-cream-50 p-3">
            <dt className="text-ink-500">Active product records</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums text-ink-900">
              {pipelineCounts.products.active}
            </dd>
          </div>
          <div className="rounded-lg bg-amber-50 p-3">
            <dt className="text-amber-800">Active, hidden: price ≤ ₹0</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums text-amber-900">
              {pipelineCounts.products.activeUnpriced}
            </dd>
          </div>
          <div className="rounded-lg bg-cream-50 p-3">
            <dt className="text-ink-500">Draft products</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums text-ink-900">
              {pipelineCounts.products.draft}
            </dd>
          </div>
          <div className="rounded-lg bg-cream-50 p-3">
            <dt className="text-ink-500">Archived products</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums text-ink-900">
              {pipelineCounts.products.archived}
            </dd>
          </div>
          <div className="rounded-lg bg-cream-50 p-3">
            <dt className="text-ink-500">Supplier records stored</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums text-ink-900">
              {pipelineCounts.supplierProducts.total}
            </dd>
          </div>
          <div className="rounded-lg bg-cream-50 p-3">
            <dt className="text-ink-500">Active supplier records</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums text-ink-900">
              {pipelineCounts.supplierProducts.active}
            </dd>
          </div>
          <div className="rounded-lg bg-cream-50 p-3">
            <dt className="text-ink-500">Inactive supplier records</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums text-ink-900">
              {pipelineCounts.supplierProducts.inactive}
            </dd>
          </div>
          <div className="rounded-lg bg-cream-50 p-3">
            <dt className="text-ink-500">Mapped to a catalogue product</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums text-ink-900">
              {pipelineCounts.supplierProducts.mapped}
            </dd>
          </div>
          <div className="rounded-lg bg-amber-50 p-3">
            <dt className="text-amber-800">Unmapped supplier records</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums text-amber-900">
              {pipelineCounts.supplierProducts.unmapped}
            </dd>
          </div>
          <div className="rounded-lg bg-amber-50 p-3">
            <dt className="text-amber-800">Last recorded import state: needs review</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums text-amber-900">
              {pipelineCounts.supplierProducts.needsReview}
            </dd>
          </div>
          <div className="rounded-lg bg-red-50 p-3">
            <dt className="text-red-800">Supplier records with import state: rejected</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums text-red-900">
              {pipelineCounts.supplierProducts.rejected}
            </dd>
          </div>
          <div className="rounded-lg bg-emerald-50 p-3">
            <dt className="text-emerald-800">Last recorded import state: published</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums text-emerald-900">
              {pipelineCounts.supplierProducts.importPublished}
            </dd>
          </div>
          <div className="rounded-lg bg-cream-50 p-3">
            <dt className="text-ink-500">Last recorded import state: draft</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums text-ink-900">
              {pipelineCounts.supplierProducts.importDraft}
            </dd>
          </div>
          <div className="rounded-lg bg-cream-50 p-3">
            <dt className="text-ink-500">Last recorded import state: unmapped</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums text-ink-900">
              {pipelineCounts.supplierProducts.importUnmapped}
            </dd>
          </div>
        </dl>
        <p className="text-xs leading-relaxed text-ink-500">
          Category and stock are not default visibility filters. Stock affects availability and
          purchase limits; “In stock only” is opt-in. Stored import states reflect the last recorded
          evaluation and may differ from current product state. A supplier record is not storefront
          visible until it maps to a reviewed, positively priced product that is set ACTIVE.
        </p>
      </section>

      {/* Automated Pipeline & Quality Gate Rules */}
      <SupplierCatalogOps
        suppliers={suppliers}
        initialConfig={{
          enabled: settings.autoImport.enabled,
          autoPublishEligible: settings.autoImport.autoPublishEligible,
          minMarginPercent: settings.autoImport.minMarginPercent,
          minProfitRupees: Math.round(settings.autoImport.minProfitPaise / 100),
          maxSellingPriceRupees: Math.round(settings.autoImport.maxSellingPricePaise / 100),
          dailyImportLimit: settings.autoImport.dailyImportLimit,
        }}
      />

      {/* Latest Sync Report & Fulfilment Readiness / Margin Alerts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card space-y-2 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-ink-900">Latest Sync &amp; Discovery Report</h2>
            {latestReport && (
              <Badge tone={latestReport.status === 'COMPLETED' ? 'green' : 'amber'}>
                {latestReport.status}
              </Badge>
            )}
          </div>
          {latestReport ? (
            <div className="space-y-2 text-xs text-ink-600">
              <p>
                <strong>{latestReport.supplierName}</strong> ({latestReport.supplierType}) — synced{' '}
                {new Date(latestReport.completedAt).toLocaleString('en-IN')}
              </p>
              <div className="grid grid-cols-3 gap-2 rounded-lg bg-cream-50 p-2.5 sm:grid-cols-5">
                <div>
                  <span className="block text-[10px] text-ink-400">Discovered</span>
                  <span className="font-bold text-ink-900">{latestReport.totals.discovered}</span>
                </div>
                <div>
                  <span className="block text-[10px] text-ink-400">Created / Updated</span>
                  <span className="font-bold text-ink-900">
                    {latestReport.totals.created} / {latestReport.totals.updated}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] text-ink-400">Auto-Imported</span>
                  <span className="font-bold text-ink-900">{latestReport.totals.autoImported}</span>
                </div>
                <div>
                  <span className="block text-[10px] text-ink-400">Auto-Published</span>
                  <span className="font-bold text-emerald-700">
                    {latestReport.totals.autoPublished}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] text-ink-400">Held / Rejected</span>
                  <span className="font-bold text-amber-700">
                    {latestReport.totals.heldForReview} / {latestReport.totals.rejected}
                  </span>
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-ink-500">
                Skipped: {latestReport.totals.skippedDuplicate} duplicate,{' '}
                {latestReport.totals.skippedNoSku} missing SKU, {latestReport.totals.skippedNoCost}{' '}
                missing or negative cost, {latestReport.totals.skippedIncomplete} incomplete.
                Per-item failures: {latestReport.totals.failed}.
              </p>
            </div>
          ) : (
            <p className="text-xs text-ink-400">
              No sync report recorded yet. Click <strong>Run Discovery &amp; Sync</strong> above to
              run the discovery pipeline.
            </p>
          )}
        </div>

        <div className="card space-y-2 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-ink-900">
              Fulfilment Readiness &amp; Data Quality Alerts
            </h2>
            <Badge tone={notReadySellable.length === 0 ? 'green' : 'amber'}>
              {readiness.summary.sellableReady}/{readiness.summary.totalSellable} Sellable Ready
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-cream-50 p-2.5 text-xs sm:grid-cols-4">
            <div>
              <span className="block text-[10px] text-ink-400">Missing Cost</span>
              <span className="font-bold text-ink-900">{readiness.summary.missingCostCount}</span>
            </div>
            <div>
              <span className="block text-[10px] text-ink-400">Unverified Ship</span>
              <span className="font-bold text-ink-900">
                {readiness.summary.missingShippingCount}
              </span>
            </div>
            <div>
              <span className="block text-[10px] text-ink-400">Missing Images</span>
              <span className="font-bold text-ink-900">{readiness.summary.missingImagesCount}</span>
            </div>
            <div>
              <span className="block text-[10px] text-ink-400">Margin Alerts</span>
              <span className="font-bold text-amber-700">{readiness.summary.marginAlertCount}</span>
            </div>
          </div>
          {notReadySellable.length > 0 && (
            <div className="text-xs text-amber-800">
              <p className="font-semibold">
                Sellable products not yet fulfilment-ready ({notReadySellable.length}):
              </p>
              <ul className="mt-1 list-disc pl-4">
                {notReadySellable.slice(0, 4).map((item) => (
                  <li key={item.productId}>
                    <Link
                      href={`/admin/products/${item.productId}`}
                      className="font-medium underline"
                    >
                      {item.name}
                    </Link>
                    : {item.issues.join(' ')}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {marginAlerts.length > 0 && (
            <div className="text-xs text-red-700">
              <p className="font-semibold">Margin alerts ({marginAlerts.length}):</p>
              <ul className="mt-1 list-disc pl-4">
                {marginAlerts.slice(0, 3).map((item) => (
                  <li key={item.productId}>
                    <Link
                      href={`/admin/products/${item.productId}`}
                      className="font-medium underline"
                    >
                      {item.name}
                    </Link>{' '}
                    ({formatINR(item.sellingPricePaise)}): {item.marginAlertReason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <SupplierProductMapper initial={rows} products={products} showSupplierColumn />
    </div>
  );
}
