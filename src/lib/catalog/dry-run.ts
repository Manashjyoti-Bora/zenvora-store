import { prisma } from '../db';
import { getSettings } from '../settings';
import { slugify } from '../utils';
import { evaluateSupplierProductCandidate } from './auto-import';
import { computeContributionMargin, type ContributionMarginResult } from './contribution-margin';
import { deriveLifecycleState, type LifecycleResult, type SupplierProductLifecycleState } from './lifecycle';
import type { DemandConfidence, ProductRankingTier, RankingFactorBreakdown } from './ranking';

/**
 * Supplier pipeline DRY RUN.
 *
 * Answers "what would the pipeline do with these supplier rows right now?"
 * using exactly the same evaluator, pricing rules, duplicate checks and
 * thresholds as the real import — but performs ZERO writes: no product rows,
 * no `raw.importState` updates, no category auto-creation, no audit entries,
 * no cache revalidation. Safe to call repeatedly from the admin UI.
 */

export interface DryRunItem {
  supplierProductId: string;
  supplierSku: string;
  externalId: string | null;
  name: string;
  categoryName: string | null;
  /** What the pipeline would do if run for real in the given mode. */
  wouldDo:
    | 'PUBLISH'
    | 'IMPORT_AS_DRAFT'
    | 'HOLD_FOR_REVIEW'
    | 'REJECT'
    | 'SKIP_DUPLICATE'
    | 'SKIP_ALREADY_MAPPED'
    | 'SKIP_VALIDATION';
  lifecycle: LifecycleResult;
  tier: ProductRankingTier;
  score: number;
  demandConfidence: DemandConfidence;
  demandSummary: string;
  sellingPricePaise: number;
  grossMarginPercent: number;
  contribution: ContributionMarginResult;
  factors: RankingFactorBreakdown[];
  rejectionReasons: string[];
  reviewReasons: string[];
  warnings: string[];
  duplicateOf: { slug: string; reason: string } | null;
  mappedProductId: string | null;
}

export interface DryRunReport {
  generatedAt: string;
  mode: 'IMPORT_ELIGIBLE_DRAFT' | 'SAFE_PUBLISH_ELIGIBLE';
  supplierId: string | null;
  examined: number;
  truncated: boolean;
  wouldPublish: number;
  wouldImportDraft: number;
  wouldHold: number;
  wouldReject: number;
  wouldSkip: number;
  /** Items that already have a catalogue product (any status). */
  alreadyMapped: number;
  lifecycleCounts: Record<SupplierProductLifecycleState, number>;
  tierCounts: Record<ProductRankingTier, number>;
  demandCounts: Record<DemandConfidence, number>;
  /** Aggregate unit economics over priceable items (estimates, not forecasts). */
  economics: {
    priceableItems: number;
    medianContributionPercent: number | null;
    itemsBelowMinMargin: number;
    itemsWithUnknownShipping: number;
  };
  thresholds: {
    autoPublishEnabled: boolean;
    minMarginPercent: number;
    minProfitPaise: number;
    minDemandConfidenceForAutoPublish: string;
    verifiedDemandMinListedNum: number;
    minScoreForAutoPublish: number;
    staleAfterHours: number;
    dailyImportLimit: number;
  };
  /** Top rejection / hold reasons with counts, for the operator. */
  topReasons: Array<{ reason: string; count: number }>;
  items: DryRunItem[];
  writes: 0;
}

const emptyLifecycleCounts = (): Record<SupplierProductLifecycleState, number> => ({
  DISCOVERED: 0,
  IMPORTING: 0,
  VALIDATION_FAILED: 0,
  NEEDS_REVIEW: 0,
  APPROVED: 0,
  SCHEDULED: 0,
  ACTIVE: 0,
  STALE: 0,
  SUPPLIER_UNAVAILABLE: 0,
  PAUSED: 0,
  REJECTED: 0,
});

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round(((s[mid - 1]! + s[mid]!) / 2) * 10) / 10;
}

export async function buildSupplierDryRunReport(params: {
  supplierId?: string | null;
  supplierProductIds?: string[];
  mode?: DryRunReport['mode'];
  limit?: number;
}): Promise<DryRunReport> {
  const mode = params.mode ?? 'IMPORT_ELIGIBLE_DRAFT';
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);

  const where = {
    ...(params.supplierId ? { supplierId: params.supplierId } : {}),
    ...(params.supplierProductIds?.length ? { id: { in: params.supplierProductIds } } : {}),
  };

  const [rows, total, settings, activeRules] = await Promise.all([
    prisma.supplierProduct.findMany({
      where,
      include: {
        supplier: true,
        product: { select: { id: true, slug: true, status: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    }),
    prisma.supplierProduct.count({ where }),
    getSettings(),
    prisma.pricingRule.findMany({ where: { isActive: true } }),
  ]);

  // Category lookup WITHOUT auto-creation (the real import may create one).
  const categories = await prisma.category.findMany({ select: { id: true, slug: true, name: true } });
  const categoryByName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c]));

  const items: DryRunItem[] = [];
  const lifecycleCounts = emptyLifecycleCounts();
  const tierCounts: Record<ProductRankingTier, number> = {
    HIGH_POTENTIAL: 0,
    PROMISING: 0,
    NEEDS_REVIEW: 0,
    NOT_ELIGIBLE: 0,
  };
  const demandCounts: Record<DemandConfidence, number> = { VERIFIED: 0, LOW_EVIDENCE: 0, UNKNOWN: 0 };
  const reasonCounts = new Map<string, number>();
  const contributions: number[] = [];
  let belowMin = 0;
  let unknownShip = 0;
  let alreadyMapped = 0;
  const minMargin = Math.max(
    settings.pricing.minMarginPercent ?? 10,
    settings.autoImport.minMarginPercent ?? 15
  );

  for (const sp of rows) {
    // Duplicate detection — same rules as importOrPublishSupplierProduct, read-only.
    let duplicateOf: DryRunItem['duplicateOf'] = null;
    if (!sp.product) {
      const bySku = await prisma.product.findFirst({
        where: { OR: [{ supplierId: sp.supplierId, supplierSku: sp.supplierSku }, { sku: sp.supplierSku }] },
        select: { slug: true },
      });
      if (bySku) {
        duplicateOf = { slug: bySku.slug, reason: `Matches existing catalog product (${bySku.slug}) by SKU ${sp.supplierSku}.` };
      }
    }
    const metaName = (() => {
      const raw = sp.raw && typeof sp.raw === 'object' && !Array.isArray(sp.raw) ? (sp.raw as Record<string, unknown>) : {};
      const dm = raw.discoveryMeta && typeof raw.discoveryMeta === 'object' ? (raw.discoveryMeta as Record<string, unknown>) : {};
      return typeof dm.name === 'string' ? dm.name : typeof raw.nameEn === 'string' ? raw.nameEn : null;
    })();
    if (!duplicateOf && !sp.product && metaName && metaName.length >= 4) {
      const bySlug = await prisma.product.findUnique({
        where: { slug: slugify(metaName) },
        select: { slug: true, supplierId: true },
      });
      if (bySlug && bySlug.supplierId === sp.supplierId) {
        duplicateOf = { slug: bySlug.slug, reason: `Matches existing catalog product (${bySlug.slug}) from the same supplier.` };
      }
    }

    const preMeta = evaluateSupplierProductCandidate({ sp, settings, activeRules }).meta;
    const matched = preMeta.categoryName ? categoryByName.get(preMeta.categoryName.trim().toLowerCase()) : undefined;
    const { meta, pricing, evaluation } = evaluateSupplierProductCandidate({
      sp,
      settings,
      activeRules,
      matchedCategoryId: matched?.id ?? null,
      matchedCategorySlug: matched?.slug ?? null,
      isDuplicate: Boolean(duplicateOf),
      duplicateReason: duplicateOf?.reason ?? null,
    });

    const supplierCostPaise = Math.round(Number(sp.supplierCost) * 100);
    const shippingKnown = sp.supplierShippingCost !== null;
    const contribution = computeContributionMargin({
      sellingPricePaise: pricing.sellingPricePaise,
      supplierCostPaise: supplierCostPaise > 0 ? supplierCostPaise : null,
      supplierShippingPaise: shippingKnown ? Math.round(Number(sp.supplierShippingCost) * 100) : null,
      taxRatePercent: settings.tax.defaultGstPercent,
      paymentFeePercent: settings.payments.feePercent,
      paymentFeeFixedPaise: settings.payments.feeFixedPaise,
      packagingPaise: settings.pricing.packagingPaise ?? 0,
      operationalPaise: settings.pricing.operationalPaise ?? 0,
      returnReservePercent: settings.pricing.returnReservePercent ?? 0,
    });

    const lifecycle = deriveLifecycleState({
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

    let wouldDo: DryRunItem['wouldDo'];
    if (sp.product) {
      alreadyMapped += 1;
      wouldDo =
        mode === 'SAFE_PUBLISH_ELIGIBLE' && sp.product.status === 'DRAFT' && evaluation.eligibleForAutoPublish
          ? 'PUBLISH'
          : 'SKIP_ALREADY_MAPPED';
    } else if (!sp.supplierSku || supplierCostPaise <= 0) {
      wouldDo = 'SKIP_VALIDATION';
    } else if (duplicateOf) {
      wouldDo = 'SKIP_DUPLICATE';
    } else if (!evaluation.eligibleForImport) {
      wouldDo = 'REJECT';
    } else if (
      mode === 'SAFE_PUBLISH_ELIGIBLE' &&
      settings.autoImport.autoPublishEligible &&
      evaluation.eligibleForAutoPublish &&
      evaluation.recommendedStatus === 'ACTIVE'
    ) {
      wouldDo = 'PUBLISH';
    } else if (evaluation.eligibleForAutoPublish) {
      wouldDo = 'IMPORT_AS_DRAFT';
    } else {
      wouldDo = 'HOLD_FOR_REVIEW';
    }

    lifecycleCounts[lifecycle.state] += 1;
    tierCounts[evaluation.tier] += 1;
    demandCounts[evaluation.demandConfidence] += 1;
    for (const r of [...evaluation.blockingReasons, ...evaluation.publicationBlockers]) {
      const key = r.replace(/\d[\d,.]*/g, '#'); // collapse numbers so reasons group
      reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
    }
    if (supplierCostPaise > 0 && pricing.sellingPricePaise > 0) {
      contributions.push(contribution.contributionPercent);
      if (pricing.effectiveMarginPercent < minMargin) belowMin += 1;
    }
    if (!shippingKnown) unknownShip += 1;

    items.push({
      supplierProductId: sp.id,
      supplierSku: sp.supplierSku,
      externalId: sp.externalId,
      name: meta.name,
      categoryName: meta.categoryName,
      wouldDo,
      lifecycle,
      tier: evaluation.tier,
      score: evaluation.score,
      demandConfidence: evaluation.demandConfidence,
      demandSummary: evaluation.demandSummary,
      sellingPricePaise: pricing.sellingPricePaise,
      grossMarginPercent: pricing.effectiveMarginPercent,
      contribution,
      factors: evaluation.factors,
      rejectionReasons: evaluation.blockingReasons,
      reviewReasons: evaluation.publicationBlockers,
      warnings: [...evaluation.warnings, ...pricing.warnings],
      duplicateOf,
      mappedProductId: sp.product?.id ?? null,
    });
  }

  const count = (w: DryRunItem['wouldDo']) => items.filter((i) => i.wouldDo === w).length;

  return {
    generatedAt: new Date().toISOString(),
    mode,
    supplierId: params.supplierId ?? null,
    examined: items.length,
    truncated: total > items.length,
    wouldPublish: count('PUBLISH'),
    wouldImportDraft: count('IMPORT_AS_DRAFT'),
    wouldHold: count('HOLD_FOR_REVIEW'),
    wouldReject: count('REJECT'),
    wouldSkip: count('SKIP_DUPLICATE') + count('SKIP_ALREADY_MAPPED') + count('SKIP_VALIDATION'),
    alreadyMapped,
    lifecycleCounts,
    tierCounts,
    demandCounts,
    economics: {
      priceableItems: contributions.length,
      medianContributionPercent: median(contributions),
      itemsBelowMinMargin: belowMin,
      itemsWithUnknownShipping: unknownShip,
    },
    thresholds: {
      autoPublishEnabled: settings.autoImport.autoPublishEligible,
      minMarginPercent: minMargin,
      minProfitPaise: Math.max(settings.pricing.minProfitPaise ?? 0, settings.autoImport.minProfitPaise ?? 0),
      minDemandConfidenceForAutoPublish: settings.autoImport.minDemandConfidenceForAutoPublish,
      verifiedDemandMinListedNum: settings.autoImport.verifiedDemandMinListedNum,
      minScoreForAutoPublish: settings.autoImport.minScoreForAutoPublish,
      staleAfterHours: settings.autoImport.staleAfterHours,
      dailyImportLimit: settings.autoImport.dailyImportLimit,
    },
    topReasons: [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([reason, count]) => ({ reason, count })),
    items,
    writes: 0,
  };
}
