import { prisma } from '../db';
import { getSettings, type StoreSettings } from '../settings';
import { computePricing, type PricingBreakdown, type PricingMode, type RoundingRule } from '../pricing/engine';
import { pickWinningRule } from '../pricing/resolve';
import { toPaise, percentOfPaise } from '../money';
import { slugify } from '../utils';
import { auditLog } from '../audit';
import { logger } from '../logger';
import { badRequest, notFound } from '../errors';
import { getSupplierAdapter } from '../suppliers/registry';
import type { SupplierProductDto, SupplierVariantDto } from '../suppliers/types';
import {
  evaluateProductCandidate,
  isValidProductImageUrl,
  type ProductEvaluationResult,
  type ProductRankingTier,
} from './ranking';
import { applyEnginePricingToProduct, saveProduct } from './products';
import { revalidateCatalog } from './revalidate';
import type { PricingRule, Supplier, SupplierProduct } from '@prisma/client';

type Actor = { id?: string | null; email?: string | null };

/**
 * ============================================================================
 * AUTOMATED CJ DISCOVERY, EVALUATION, IMPORT & QUALITY-GATED PUBLICATION
 * ============================================================================
 *
 * Implements the full automated pipeline:
 *   Discover → Validate → Deduplicate → Calculate Landed Cost → Apply Pricing Rule
 *   → Check Eligibility & Quality Gates → Import Product + Variants + Images
 *   → Publish When Eligible → Revalidate Storefront Cache
 */

export interface ExtractedSupplierMetadata {
  name: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  brand: string | null;
  variantId: string | null;
  images: string[];
  weightGrams: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  listedNum: number | null;
  shippingSupportedToIndia: boolean | null;
  variants: SupplierVariantDto[];
  specifications: Record<string, string>;
  fieldSources: Record<string, string>;
  evaluation: ProductEvaluationResult | null;
  importState: {
    status: 'PUBLISHED' | 'DRAFT' | 'NEEDS_REVIEW' | 'REJECTED' | 'UNMAPPED';
    reasons: string[];
    productId?: string | null;
    updatedAt: string;
  } | null;
}

export interface SupplierSyncCheckpoint {
  supplierId: string;
  inProgress: boolean;
  cursor: string | null;
  source: string;
  pageNum: number;
  fetchedCount: number;
  startedAt: string;
  updatedAt: string;
  lastError?: string | null;
}

export interface SupplierSyncReportItem {
  supplierProductId?: string;
  sku: string;
  externalId?: string | null;
  name: string;
  outcome:
    | 'PUBLISHED'
    | 'SAVED_AS_DRAFT'
    | 'HELD_FOR_REVIEW'
    | 'REJECTED'
    | 'UPDATED_EXISTING'
    | 'SKIPPED_DUPLICATE'
    | 'SKIPPED_INVALID';
  tier?: ProductRankingTier;
  score?: number;
  sellingPricePaise?: number;
  grossMarginPercent?: number;
  reasons: string[];
  productId?: string | null;
}

export interface SupplierSyncReport {
  supplierId: string;
  supplierName: string;
  supplierType: string;
  startedAt: string;
  completedAt: string;
  status: 'COMPLETED' | 'PARTIAL_FAILURE' | 'FAILED';
  resumedFromCursor: string | null;
  lastCursor: string | null;
  errorMessage?: string | null;
  totals: {
    discovered: number;
    created: number;
    updated: number;
    skippedDuplicate: number;
    skippedNoSku: number;
    skippedNoCost: number;
    skippedIncomplete: number;
    failed: number;
    repricedMappedProducts: number;
    marginAlertsCount: number;
    autoImported: number;
    autoPublished: number;
    savedAsDraft: number;
    heldForReview: number;
    rejected: number;
  };
  tierCounts: Record<ProductRankingTier, number>;
  items: SupplierSyncReportItem[];
}

function strOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * Extracts normalized discovery metadata, provenance, and evaluation state from
 * a `SupplierProduct` row and its `raw` JSON field.
 */
export function extractSupplierProductMetadata(
  sp: Pick<SupplierProduct, 'supplierSku' | 'externalId' | 'raw'>
): ExtractedSupplierMetadata {
  const raw =
    sp.raw && typeof sp.raw === 'object' && !Array.isArray(sp.raw)
      ? (sp.raw as Record<string, unknown>)
      : {};
  const meta =
    raw.discoveryMeta && typeof raw.discoveryMeta === 'object' && !Array.isArray(raw.discoveryMeta)
      ? (raw.discoveryMeta as Record<string, unknown>)
      : {};

  const name =
    strOrNull(meta.name) ??
    strOrNull(raw.nameEn) ??
    strOrNull(raw.productNameEn) ??
    strOrNull(raw.productName) ??
    strOrNull(raw.name) ??
    strOrNull(raw.title) ??
    sp.supplierSku;

  const description =
    strOrNull(meta.description) ??
    strOrNull(raw.description) ??
    strOrNull(raw.productDescription) ??
    strOrNull(raw.entryNameEn) ??
    null;

  const categoryId =
    strOrNull(meta.categoryId) ??
    strOrNull(raw.categoryId) ??
    strOrNull(raw.threeCategoryId) ??
    null;

  const categoryName =
    strOrNull(meta.categoryName) ??
    strOrNull(raw.categoryName) ??
    strOrNull(raw.threeCategoryName) ??
    strOrNull(raw.twoCategoryName) ??
    strOrNull(raw.oneCategoryName) ??
    null;

  const brand = strOrNull(meta.brand) ?? strOrNull(raw.brand) ?? null;
  const variantId =
    strOrNull(meta.variantId) ?? strOrNull(raw.vid) ?? strOrNull(raw.variantId) ?? null;

  const imagesRaw: string[] = [];
  if (Array.isArray(meta.images)) {
    for (const img of meta.images) {
      if (typeof img === 'string' && isValidProductImageUrl(img)) imagesRaw.push(img.trim());
    }
  }
  for (const key of ['bigImage', 'productImage', 'image', 'variantImage', 'img']) {
    const val = raw[key];
    if (typeof val === 'string' && isValidProductImageUrl(val) && !imagesRaw.includes(val.trim())) {
      imagesRaw.push(val.trim());
    }
  }
  if (Array.isArray(raw.productImageSet)) {
    for (const img of raw.productImageSet) {
      if (typeof img === 'string' && isValidProductImageUrl(img) && !imagesRaw.includes(img.trim())) {
        imagesRaw.push(img.trim());
      }
    }
  }

  const weightGrams =
    numOrNull(meta.weightGrams) ??
    numOrNull(raw.productWeight ?? raw.packingWeight ?? raw.weight);
  const lengthCm = numOrNull(meta.lengthCm ?? raw.packLength);
  const widthCm = numOrNull(meta.widthCm ?? raw.packWidth);
  const heightCm = numOrNull(meta.heightCm ?? raw.packHeight);
  const listedNum = numOrNull(meta.listedNum ?? raw.listedNum);

  const shippingSupportedToIndia =
    typeof meta.shippingSupportedToIndia === 'boolean'
      ? meta.shippingSupportedToIndia
      : typeof raw.shippingSupportedToIndia === 'boolean'
        ? raw.shippingSupportedToIndia
        : null;

  const variants: SupplierVariantDto[] = Array.isArray(meta.variants)
    ? (meta.variants as SupplierVariantDto[])
    : [];

  const specifications: Record<string, string> =
    meta.specifications &&
    typeof meta.specifications === 'object' &&
    !Array.isArray(meta.specifications)
      ? (meta.specifications as Record<string, string>)
      : {};

  const fieldSources: Record<string, string> =
    meta.fieldSources &&
    typeof meta.fieldSources === 'object' &&
    !Array.isArray(meta.fieldSources)
      ? (meta.fieldSources as Record<string, string>)
      : {};

  const evaluation =
    raw.evaluation && typeof raw.evaluation === 'object' && !Array.isArray(raw.evaluation)
      ? (raw.evaluation as ProductEvaluationResult)
      : null;

  const importState =
    raw.importState && typeof raw.importState === 'object' && !Array.isArray(raw.importState)
      ? (raw.importState as ExtractedSupplierMetadata['importState'])
      : null;

  return {
    name,
    description,
    categoryId,
    categoryName,
    brand,
    variantId,
    images: imagesRaw,
    weightGrams: weightGrams !== null && weightGrams > 0 ? Math.round(weightGrams) : null,
    lengthCm,
    widthCm,
    heightCm,
    listedNum: listedNum !== null && listedNum >= 0 ? Math.trunc(listedNum) : null,
    shippingSupportedToIndia,
    variants,
    specifications,
    fieldSources,
    evaluation,
    importState,
  };
}

/**
 * Computes landed cost, resolves the applicable pricing rule, computes the
 * selling price and profit breakdown, and evaluates Indian reselling
 * eligibility and ranking for a `SupplierProduct`.
 */
export function evaluateSupplierProductCandidate(params: {
  sp: SupplierProduct & { supplier: Supplier; product?: { id: string; status: string } | null };
  settings: StoreSettings;
  activeRules: PricingRule[];
  matchedCategoryId?: string | null;
  matchedCategorySlug?: string | null;
  isDuplicate?: boolean;
  duplicateReason?: string | null;
}): {
  meta: ExtractedSupplierMetadata;
  pricing: PricingBreakdown;
  ruleUsed: PricingRule | null;
  evaluation: ProductEvaluationResult;
} {
  const { sp, settings, activeRules } = params;
  const meta = extractSupplierProductMetadata(sp);

  const supplierCostPaise = toPaise(sp.supplierCost);
  const shippingKnown = sp.supplierShippingCost !== null;
  const supplierShippingPaise = shippingKnown ? toPaise(sp.supplierShippingCost!) : 0;

  // Include store-configured packaging, operational, and return-reserve overheads
  const packagingPaise = settings.pricing.packagingPaise ?? 0;
  const operationalPaise = settings.pricing.operationalPaise ?? 0;
  const returnReservePaise = percentOfPaise(
    supplierCostPaise + supplierShippingPaise,
    settings.pricing.returnReservePercent ?? 0
  );
  const otherCostPaise = packagingPaise + operationalPaise + returnReservePaise;

  const ruleUsed = pickWinningRule(activeRules, {
    categoryId: params.matchedCategoryId ?? null,
    supplierId: sp.supplierId,
  });

  let mode: PricingMode = 'PERCENT_MARKUP';
  let percentMarkup: number | null = settings.pricing.defaultMarkupPercent ?? 40;
  let fixedMarginPaise: number | null = null;
  let minProfitPaise: number | null = Math.max(
    settings.pricing.minProfitPaise ?? 0,
    settings.autoImport.minProfitPaise ?? 0
  );
  let roundingRule: RoundingRule = settings.pricing.defaultRoundingRule ?? 'NEAREST_99';

  if (ruleUsed) {
    roundingRule = ruleUsed.roundingRule;
    const ruleMinProfit = ruleUsed.minProfit != null ? toPaise(ruleUsed.minProfit) : 0;
    minProfitPaise = Math.max(minProfitPaise, ruleMinProfit);
    if (ruleUsed.mode === 'PERCENT_MARKUP') {
      mode = 'PERCENT_MARKUP';
      percentMarkup =
        ruleUsed.percentMarkup != null ? Number(ruleUsed.percentMarkup) : percentMarkup;
    } else if (ruleUsed.mode === 'FIXED_MARGIN') {
      mode = 'FIXED_MARGIN';
      fixedMarginPaise = ruleUsed.fixedMargin != null ? toPaise(ruleUsed.fixedMargin) : 0;
    }
  }

  const minMarginPercent = Math.max(
    settings.pricing.minMarginPercent ?? 10,
    settings.autoImport.minMarginPercent ?? 15
  );

  const pricing = computePricing({
    supplierCostPaise: Math.max(0, supplierCostPaise),
    supplierShippingPaise: Math.max(0, supplierShippingPaise),
    otherCostPaise: Math.max(0, otherCostPaise),
    mode,
    percentMarkup,
    fixedMarginPaise,
    minProfitPaise,
    minMarginPercent,
    minSellingPricePaise: Math.max(
      settings.pricing.minSellingPricePaise ?? 0,
      settings.autoImport.minSellingPricePaise ?? 0
    ),
    maxSellingPricePaise: settings.autoImport.maxSellingPricePaise ?? 0,
    roundingRule,
    paymentFeePercent: settings.payments.feePercent,
    paymentFeeFixedPaise: settings.payments.feeFixedPaise,
    taxRatePercent: settings.tax.defaultGstPercent,
  });

  const evaluation = evaluateProductCandidate(
    {
      supplierId: sp.supplierId,
      supplierName: sp.supplier.name,
      supplierType: sp.supplier.type,
      supplierActive: sp.supplier.isActive,
      supplierSku: sp.supplierSku,
      externalId: sp.externalId,
      variantId: meta.variantId,
      name: meta.name,
      description: meta.description,
      categoryName: meta.categoryName,
      categorySlug: params.matchedCategorySlug ?? null,
      brand: meta.brand,
      images: meta.images,
      specifications: meta.specifications,
      variants: meta.variants,
      supplierCostPaise: supplierCostPaise > 0 ? supplierCostPaise : null,
      supplierShippingPaise: shippingKnown ? supplierShippingPaise : null,
      shippingKnown,
      otherCostPaise,
      sellingPricePaise: pricing.sellingPricePaise,
      grossMarginPaise: pricing.grossMarginPaise,
      effectiveMarginPercent: pricing.effectiveMarginPercent,
      estimatedNetProfitPaise: pricing.estimatedNetProfitPaise,
      inStock: sp.inStock,
      stockQty: sp.stockQty,
      lastSyncedAt: sp.lastSyncedAt,
      weightGrams: meta.weightGrams,
      lengthCm: meta.lengthCm,
      widthCm: meta.widthCm,
      heightCm: meta.heightCm,
      shippingSupportedToIndia: meta.shippingSupportedToIndia ?? (shippingKnown ? true : null),
      listedNum: meta.listedNum,
      isDuplicate: params.isDuplicate ?? false,
      duplicateReason: params.duplicateReason ?? null,
    },
    settings
  );

  return { meta, pricing, ruleUsed, evaluation };
}

/**
 * Resolves or auto-creates a storefront Category for a discovered supplier category name.
 */
async function resolveOrCreateCategory(
  categoryName: string | null | undefined
): Promise<{ id: string; slug: string; name: string } | null> {
  if (!categoryName || !categoryName.trim()) return null;
  const cleanName = categoryName.trim().slice(0, 80);
  const candidateSlug = slugify(cleanName);
  if (!candidateSlug) return null;

  const existing = await prisma.category.findFirst({
    where: {
      OR: [
        { slug: candidateSlug },
        { name: { equals: cleanName, mode: 'insensitive' } },
      ],
    },
    select: { id: true, slug: true, name: true, isActive: true },
  });
  if (existing) {
    if (!existing.isActive) return null;
    return { id: existing.id, slug: existing.slug, name: existing.name };
  }

  try {
    const created = await prisma.category.create({
      data: {
        name: cleanName,
        slug: candidateSlug,
        isActive: true,
        description: `${cleanName} collection`,
      },
      select: { id: true, slug: true, name: true },
    });
    return created;
  } catch {
    const fallback = await prisma.category.findUnique({
      where: { slug: candidateSlug },
      select: { id: true, slug: true, name: true },
    });
    return fallback;
  }
}

/**
 * Counts how many products were auto-imported in the last 24 hours to enforce
 * `settings.autoImport.dailyImportLimit`.
 */
export async function getTodayAutoImportCount(): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600_000);
  return prisma.auditLog.count({
    where: {
      action: { in: ['supplier_product.auto_imported', 'supplier_product.published'] },
      createdAt: { gte: since },
    },
  });
}

/**
 * Imports (and optionally publishes when all quality gates pass) a single
 * `SupplierProduct` through the full evaluation & quality-gate pipeline.
 */
export async function importOrPublishSupplierProduct(params: {
  supplierProductId: string;
  allowAutoPublish?: boolean;
  forceDraft?: boolean;
  actor: Actor;
}): Promise<{
  outcome: 'PUBLISHED' | 'SAVED_AS_DRAFT' | 'HELD_FOR_REVIEW' | 'REJECTED' | 'ALREADY_MAPPED';
  productId: string | null;
  slug: string | null;
  sellingPricePaise: number;
  evaluation: ProductEvaluationResult;
  reasons: string[];
}> {
  const sp = await prisma.supplierProduct.findUnique({
    where: { id: params.supplierProductId },
    include: {
      supplier: true,
      product: { select: { id: true, slug: true, status: true } },
    },
  });
  if (!sp) throw notFound('Supplier product not found');

  const [settings, activeRules] = await Promise.all([
    getSettings(),
    prisma.pricingRule.findMany({ where: { isActive: true } }),
  ]);

  const meta = extractSupplierProductMetadata(sp);
  const category = await resolveOrCreateCategory(meta.categoryName);

  // Deduplication check against existing catalog products
  let duplicateProduct: { id: string; slug: string; status: string } | null = sp.product ?? null;
  let duplicateReason: string | null = null;
  if (!duplicateProduct) {
    const bySku = await prisma.product.findFirst({
      where: {
        OR: [
          { supplierId: sp.supplierId, supplierSku: sp.supplierSku },
          { sku: sp.supplierSku },
        ],
      },
      select: { id: true, slug: true, status: true },
    });
    if (bySku) {
      duplicateProduct = bySku;
      duplicateReason = `Matches existing catalog product (${bySku.slug}) by SKU ${sp.supplierSku}.`;
    } else if (meta.name && meta.name.length >= 4) {
      const candidateSlug = slugify(meta.name);
      const bySlug = await prisma.product.findUnique({
        where: { slug: candidateSlug },
        select: { id: true, slug: true, status: true, supplierId: true },
      });
      if (bySlug && bySlug.supplierId === sp.supplierId) {
        duplicateProduct = bySlug;
        duplicateReason = `Matches existing catalog product (${bySlug.slug}) from the same supplier.`;
      }
    }
  }

  const { pricing, ruleUsed, evaluation } = evaluateSupplierProductCandidate({
    sp,
    settings,
    activeRules,
    matchedCategoryId: category?.id ?? null,
    matchedCategorySlug: category?.slug ?? null,
    isDuplicate: Boolean(duplicateProduct && !sp.productId),
    duplicateReason,
  });

  // If already mapped (or matched to an existing product), link or skip duplicate safely
  if (duplicateProduct) {
    if (!sp.productId) {
      const otherOwner = await prisma.supplierProduct.findUnique({
        where: { productId: duplicateProduct.id },
        select: { id: true, supplierSku: true },
      });
      if (otherOwner && otherOwner.id !== sp.id) {
        const dupMsg =
          duplicateReason ??
          `Duplicate of catalog product ${duplicateProduct.slug} (already linked to supplier SKU ${otherOwner.supplierSku}).`;
        await prisma.supplierProduct.update({
          where: { id: sp.id },
          data: {
            raw: buildUpdatedRaw(sp.raw, meta, evaluation, {
              status: 'NEEDS_REVIEW',
              reasons: [dupMsg],
              productId: null,
              updatedAt: new Date().toISOString(),
            }),
          },
        });
        return {
          outcome: 'HELD_FOR_REVIEW',
          productId: null,
          slug: null,
          sellingPricePaise: pricing.sellingPricePaise,
          evaluation,
          reasons: [dupMsg],
        };
      }
      await prisma.supplierProduct.update({
        where: { id: sp.id },
        data: {
          productId: duplicateProduct.id,
          raw: buildUpdatedRaw(sp.raw, meta, evaluation, {
            status: duplicateProduct.status === 'ACTIVE' ? 'PUBLISHED' : 'DRAFT',
            reasons: duplicateReason ? [duplicateReason] : [],
            productId: duplicateProduct.id,
            updatedAt: new Date().toISOString(),
          }),
        },
      });
    }
    return {
      outcome: 'ALREADY_MAPPED',
      productId: duplicateProduct.id,
      slug: duplicateProduct.slug,
      sellingPricePaise: pricing.sellingPricePaise,
      evaluation,
      reasons: duplicateReason ? [duplicateReason] : ['Already mapped to catalog product.'],
    };
  }

  // Quality Gate 1: Reject NOT_ELIGIBLE items (prohibited, missing cost, out of stock, etc.)
  if (!evaluation.eligibleForImport || evaluation.tier === 'NOT_ELIGIBLE') {
    await prisma.supplierProduct.update({
      where: { id: sp.id },
      data: {
        raw: buildUpdatedRaw(sp.raw, meta, evaluation, {
          status: 'REJECTED',
          reasons: evaluation.blockingReasons,
          productId: null,
          updatedAt: new Date().toISOString(),
        }),
      },
    });
    return {
      outcome: 'REJECTED',
      productId: null,
      slug: null,
      sellingPricePaise: pricing.sellingPricePaise,
      evaluation,
      reasons: evaluation.blockingReasons,
    };
  }

  // Determine whether this product can be published as ACTIVE or must be saved as DRAFT / NEEDS_REVIEW
  const canPublishActive =
    !params.forceDraft &&
    Boolean(params.allowAutoPublish) &&
    evaluation.eligibleForAutoPublish &&
    meta.images.length > 0 &&
    Boolean(meta.description && meta.description.trim().length >= settings.autoImport.minDescriptionLength);

  const targetStatus: 'ACTIVE' | 'DRAFT' = canPublishActive ? 'ACTIVE' : 'DRAFT';

  const baseSlug = slugify(meta.name) || slugify(sp.supplierSku) || `item-${sp.id.slice(0, 8)}`;
  const uniqueSlug = await ensureUniqueProductSlug(baseSlug);

  const supplierCostPaise = toPaise(sp.supplierCost);
  const supplierShippingPaise =
    sp.supplierShippingCost !== null ? toPaise(sp.supplierShippingCost) : 0;
  const packagingPaise = settings.pricing.packagingPaise ?? 0;
  const operationalPaise = settings.pricing.operationalPaise ?? 0;
  const returnReservePaise = percentOfPaise(
    supplierCostPaise + supplierShippingPaise,
    settings.pricing.returnReservePercent ?? 0
  );
  const otherCostPaise = packagingPaise + operationalPaise + returnReservePaise;

  let pricingMode: PricingMode = 'PERCENT_MARKUP';
  let percentMarkup: number | null = settings.pricing.defaultMarkupPercent ?? 40;
  let fixedMargin: number | null = null;
  let minProfit: number | null = Math.max(
    settings.pricing.minProfitPaise ?? 0,
    settings.autoImport.minProfitPaise ?? 0
  );
  let roundingRule: RoundingRule = settings.pricing.defaultRoundingRule ?? 'NEAREST_99';

  if (ruleUsed) {
    roundingRule = ruleUsed.roundingRule;
    const ruleMinProfit = ruleUsed.minProfit != null ? toPaise(ruleUsed.minProfit) : 0;
    minProfit = Math.max(minProfit, ruleMinProfit);
    if (ruleUsed.mode === 'PERCENT_MARKUP') {
      pricingMode = 'PERCENT_MARKUP';
      percentMarkup = ruleUsed.percentMarkup != null ? Number(ruleUsed.percentMarkup) : percentMarkup;
    } else if (ruleUsed.mode === 'FIXED_MARGIN') {
      pricingMode = 'FIXED_MARGIN';
      fixedMargin = ruleUsed.fixedMargin != null ? toPaise(ruleUsed.fixedMargin) : 0;
    }
  }

  const descriptionText =
    meta.description && meta.description.trim().length >= 10
      ? meta.description.trim()
      : `${meta.name} — imported from ${sp.supplier.name} (SKU: ${sp.supplierSku}). Review and complete product description before publishing.`;

  const variantInputs = (meta.variants ?? []).slice(0, 30).map((v, idx) => ({
    name: v.name || v.sku || `Option ${idx + 1}`,
    sku: v.sku || v.vid || `${sp.supplierSku}-V${idx + 1}`,
    size: v.size ?? null,
    color: v.color ?? null,
    supplierCost: v.costPaise != null && v.costPaise > 0 ? v.costPaise : supplierCostPaise,
    sellingPrice: null, // Computed automatically by saveProduct's variant pricing engine!
    compareAtPrice: null,
    taxRatePercent: null,
    stock: v.stockQty ?? sp.stockQty ?? 0,
    isActive: v.inStock !== false,
    sortOrder: idx,
  }));

  const imageInputs = meta.images.slice(0, 8).map((url, idx) => ({
    url,
    alt: meta.name.slice(0, 180),
    position: idx,
    isPrimary: idx === 0,
  }));

  const specLines = Object.entries(meta.specifications ?? {})
    .filter(([k, v]) => Boolean(k && v))
    .map(([k, v]) => `• ${k}: ${v}`)
    .join('\n');
  const fullDescription = specLines
    ? `${descriptionText}\n\nSpecifications:\n${specLines}`
    : descriptionText;

  const saved = await saveProduct(
    {
      name: meta.name.slice(0, 180),
      slug: uniqueSlug.slice(0, 88),
      sku: sp.supplierSku.slice(0, 60),
      shortDescription: meta.description ? meta.description.slice(0, 260) : null,
      description: fullDescription.slice(0, 15000),
      brand: meta.brand,
      categoryId: category?.id ?? null,
      supplierId: sp.supplierId,
      supplierSku: sp.supplierSku,
      status: targetStatus,
      stockMode: 'SUPPLIER_SYNC',
      weightGrams: meta.weightGrams,
      lengthCm: meta.lengthCm != null ? Math.round(meta.lengthCm * 100) : null,
      widthCm: meta.widthCm != null ? Math.round(meta.widthCm * 100) : null,
      heightCm: meta.heightCm != null ? Math.round(meta.heightCm * 100) : null,
      supplierCost: supplierCostPaise,
      supplierShippingCost: supplierShippingPaise,
      otherCost: otherCostPaise,
      pricingMode,
      fixedPrice: null,
      fixedMargin,
      percentMarkup,
      minProfit,
      roundingRule,
      compareAtPrice: null,
      taxRatePercent: settings.tax.defaultGstPercent,
      seoTitle: meta.name.slice(0, 68),
      seoDescription: meta.description ? meta.description.slice(0, 155) : null,
      images: imageInputs,
      variants: variantInputs,
    },
    params.actor
  );

  const importStatus =
    targetStatus === 'ACTIVE'
      ? 'PUBLISHED'
      : evaluation.publicationBlockers.length > 0
        ? 'NEEDS_REVIEW'
        : 'DRAFT';

  const reasons =
    targetStatus === 'ACTIVE'
      ? [evaluation.summary]
      : evaluation.publicationBlockers.length > 0
        ? evaluation.publicationBlockers
        : ['Imported as DRAFT (automatic publication is disabled or requires admin sign-off).'];

  await prisma.supplierProduct.update({
    where: { id: sp.id },
    data: {
      productId: saved.id,
      raw: buildUpdatedRaw(sp.raw, meta, evaluation, {
        status: importStatus,
        reasons,
        productId: saved.id,
        updatedAt: new Date().toISOString(),
      }),
    },
  });

  await auditLog({
    actor: params.actor,
    action: 'supplier_product.auto_imported',
    entityType: 'Product',
    entityId: saved.id,
    data: {
      supplierProductId: sp.id,
      supplierId: sp.supplierId,
      supplierSku: sp.supplierSku,
      status: targetStatus,
      tier: evaluation.tier,
      score: evaluation.score,
      sellingPricePaise: saved.sellingPricePaise,
      reasons,
    },
  });

  return {
    outcome:
      targetStatus === 'ACTIVE'
        ? 'PUBLISHED'
        : importStatus === 'NEEDS_REVIEW'
          ? 'HELD_FOR_REVIEW'
          : 'SAVED_AS_DRAFT',
    productId: saved.id,
    slug: saved.slug,
    sellingPricePaise: saved.sellingPricePaise,
    evaluation,
    reasons,
  };
}

function buildUpdatedRaw(
  existingRaw: unknown,
  meta: ExtractedSupplierMetadata,
  evaluation: ProductEvaluationResult,
  importState: NonNullable<ExtractedSupplierMetadata['importState']>
): object {
  const base =
    existingRaw && typeof existingRaw === 'object' && !Array.isArray(existingRaw)
      ? (existingRaw as Record<string, unknown>)
      : {};
  return {
    ...base,
    discoveryMeta: {
      name: meta.name,
      description: meta.description,
      categoryId: meta.categoryId,
      categoryName: meta.categoryName,
      brand: meta.brand,
      variantId: meta.variantId,
      images: meta.images,
      weightGrams: meta.weightGrams,
      lengthCm: meta.lengthCm,
      widthCm: meta.widthCm,
      heightCm: meta.heightCm,
      listedNum: meta.listedNum,
      shippingSupportedToIndia: meta.shippingSupportedToIndia,
      variants: meta.variants,
      specifications: meta.specifications,
      fieldSources: meta.fieldSources,
    },
    evaluation,
    importState,
  };
}

async function ensureUniqueProductSlug(baseSlug: string): Promise<string> {
  let candidate = baseSlug.slice(0, 160);
  let i = 1;
  while (await prisma.product.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    i += 1;
    candidate = `${baseSlug.slice(0, 150)}-${i}`;
  }
  return candidate;
}

const SYNC_REPORT_KEY_PREFIX = 'supplier_sync_report:';
const SYNC_CHECKPOINT_KEY_PREFIX = 'supplier_sync_checkpoint:';

export async function getSupplierSyncReport(supplierId: string): Promise<SupplierSyncReport | null> {
  const row = await prisma.setting.findUnique({
    where: { key: `${SYNC_REPORT_KEY_PREFIX}${supplierId}` },
  });
  if (!row || !row.value || typeof row.value !== 'object') return null;
  return row.value as unknown as SupplierSyncReport;
}

export async function getAllSupplierSyncReports(): Promise<SupplierSyncReport[]> {
  const rows = await prisma.setting.findMany({
    where: { key: { startsWith: SYNC_REPORT_KEY_PREFIX } },
  });
  return rows
    .map((r) => r.value as unknown as SupplierSyncReport)
    .filter((r) => Boolean(r && r.supplierId))
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
}

export async function getSupplierSyncCheckpoint(
  supplierId: string
): Promise<SupplierSyncCheckpoint | null> {
  const row = await prisma.setting.findUnique({
    where: { key: `${SYNC_CHECKPOINT_KEY_PREFIX}${supplierId}` },
  });
  if (!row || !row.value || typeof row.value !== 'object') return null;
  return row.value as unknown as SupplierSyncCheckpoint;
}

async function saveSupplierSyncCheckpoint(checkpoint: SupplierSyncCheckpoint): Promise<void> {
  await prisma.setting.upsert({
    where: { key: `${SYNC_CHECKPOINT_KEY_PREFIX}${checkpoint.supplierId}` },
    create: {
      key: `${SYNC_CHECKPOINT_KEY_PREFIX}${checkpoint.supplierId}`,
      value: checkpoint as unknown as object,
    },
    update: { value: checkpoint as unknown as object },
  });
}

async function saveSupplierSyncReport(report: SupplierSyncReport): Promise<void> {
  await prisma.setting.upsert({
    where: { key: `${SYNC_REPORT_KEY_PREFIX}${report.supplierId}` },
    create: {
      key: `${SYNC_REPORT_KEY_PREFIX}${report.supplierId}`,
      value: report as unknown as object,
    },
    update: { value: report as unknown as object },
  });
}

/**
 * Runs the complete Resumable Supplier Discovery → Deduplication → Evaluation
 * → Auto-Import → Quality-Gated Auto-Publish pipeline for a supplier.
 */
export async function syncAndAutoProcessSupplier(params: {
  supplierId: string;
  limit?: number;
  includeGeneralCatalog?: boolean;
  categoryId?: string;
  keyword?: string;
  enrichDetails?: boolean;
  verifyIndiaFreight?: boolean;
  autoImport?: boolean;
  autoPublishEligible?: boolean;
  resumeFromCheckpoint?: boolean;
  actor: Actor;
}): Promise<SupplierSyncReport> {
  const startedAt = new Date().toISOString();
  const supplier = await prisma.supplier.findUnique({ where: { id: params.supplierId } });
  if (!supplier) throw notFound('Supplier not found');

  const adapter = getSupplierAdapter(supplier);
  if (!adapter.capabilities.catalogSync || (!adapter.getProducts && !adapter.discoverCatalog)) {
    throw badRequest(`Supplier "${supplier.name}" does not support catalog sync`);
  }

  const existingCheckpoint = params.resumeFromCheckpoint
    ? await getSupplierSyncCheckpoint(supplier.id)
    : null;
  const resumeCursor =
    existingCheckpoint?.inProgress && existingCheckpoint.cursor ? existingCheckpoint.cursor : null;

  let lastCursor: string | null = resumeCursor;

  await saveSupplierSyncCheckpoint({
    supplierId: supplier.id,
    inProgress: true,
    cursor: resumeCursor,
    source: 'starting',
    pageNum: 1,
    fetchedCount: 0,
    startedAt,
    updatedAt: startedAt,
    lastError: null,
  });

  const totals: SupplierSyncReport['totals'] = {
    discovered: 0,
    created: 0,
    updated: 0,
    skippedDuplicate: 0,
    skippedNoSku: 0,
    skippedNoCost: 0,
    skippedIncomplete: 0,
    failed: 0,
    repricedMappedProducts: 0,
    marginAlertsCount: 0,
    autoImported: 0,
    autoPublished: 0,
    savedAsDraft: 0,
    heldForReview: 0,
    rejected: 0,
  };
  const tierCounts: Record<ProductRankingTier, number> = {
    HIGH_POTENTIAL: 0,
    PROMISING: 0,
    NEEDS_REVIEW: 0,
    NOT_ELIGIBLE: 0,
  };
  const reportItems: SupplierSyncReportItem[] = [];

  let fetched: SupplierProductDto[] = [];
  let syncError: string | null = null;

  try {
    if (adapter.discoverCatalog) {
      fetched = await adapter.discoverCatalog({
        limit: params.limit ?? 200,
        cursor: resumeCursor ?? undefined,
        includeGeneralCatalog: params.includeGeneralCatalog,
        categoryId: params.categoryId,
        keyword: params.keyword,
        enrichDetails: params.enrichDetails,
        verifyIndiaFreight: params.verifyIndiaFreight,
        onPageProgress: async (prog) => {
          lastCursor = prog.cursor;
          await saveSupplierSyncCheckpoint({
            supplierId: supplier.id,
            inProgress: true,
            cursor: prog.cursor,
            source: prog.source,
            pageNum: prog.pageNum,
            fetchedCount: prog.fetchedCount,
            startedAt,
            updatedAt: new Date().toISOString(),
          });
        },
      });
    } else if (adapter.getProducts) {
      fetched = await adapter.getProducts({
        limit: params.limit ?? 200,
        cursor: resumeCursor ?? undefined,
      });
    }
  } catch (err) {
    syncError = err instanceof Error ? err.message : String(err);
    await saveSupplierSyncCheckpoint({
      supplierId: supplier.id,
      inProgress: true,
      cursor: lastCursor,
      source: 'error',
      pageNum: 1,
      fetchedCount: fetched.length,
      startedAt,
      updatedAt: new Date().toISOString(),
      lastError: syncError,
    });
    throw err;
  }

  totals.discovered = fetched.length;

  const [settings, activeRules] = await Promise.all([
    getSettings(),
    prisma.pricingRule.findMany({ where: { isActive: true } }),
  ]);

  const seenSkusInBatch = new Set<string>();
  const seenExtIdsInBatch = new Set<string>();
  const syncedSupplierProductIds: string[] = [];

  for (const dto of fetched) {
    const sku = (dto.sku ?? '').trim();
    if (!sku) {
      totals.skippedNoSku += 1;
      continue;
    }

    const skuKey = sku.toLowerCase();
    const extKey = dto.externalId ? dto.externalId.trim().toLowerCase() : '';
    if (seenSkusInBatch.has(skuKey) || (extKey && seenExtIdsInBatch.has(extKey))) {
      totals.skippedDuplicate += 1;
      continue;
    }
    seenSkusInBatch.add(skuKey);
    if (extKey) seenExtIdsInBatch.add(extKey);

    if (dto.costPaise == null || dto.costPaise < 0) {
      totals.skippedNoCost += 1;
      reportItems.push({
        sku,
        externalId: dto.externalId ?? null,
        name: dto.name ?? sku,
        outcome: 'SKIPPED_INVALID',
        reasons: ['Missing or unparseable supplier cost from supplier API.'],
      });
      continue;
    }

    const existing =
      (await prisma.supplierProduct.findUnique({
        where: { supplierId_supplierSku: { supplierId: supplier.id, supplierSku: sku } },
      })) ??
      (dto.externalId
        ? await prisma.supplierProduct.findFirst({
            where: { supplierId: supplier.id, externalId: dto.externalId },
          })
        : null);

    const existingRaw =
      existing?.raw && typeof existing.raw === 'object' && !Array.isArray(existing.raw)
        ? (existing.raw as Record<string, unknown>)
        : {};
    const dtoRaw =
      dto.raw && typeof dto.raw === 'object' && !Array.isArray(dto.raw)
        ? (dto.raw as Record<string, unknown>)
        : {};

    const discoveryMeta = {
      name: dto.name ?? existingRaw.name ?? sku,
      description: dto.description ?? null,
      categoryId: dto.categoryId ?? null,
      categoryName: dto.categoryName ?? null,
      brand: dto.brand ?? null,
      variantId: dto.variantId ?? null,
      images: dto.images ?? [],
      weightGrams: dto.weightGrams ?? null,
      lengthCm: dto.lengthCm ?? null,
      widthCm: dto.widthCm ?? null,
      heightCm: dto.heightCm ?? null,
      listedNum: dto.listedNum ?? null,
      shippingSupportedToIndia: dto.shippingSupportedToIndia ?? null,
      variants: dto.variants ?? [],
      specifications: dto.specifications ?? {},
      fieldSources: {
        ...(dto.fieldSources ?? {}),
        lastSyncedAt: new Date().toISOString(),
      },
    };

    const mergedRaw = {
      ...existingRaw,
      ...dtoRaw,
      discoveryMeta,
    };

    const data = {
      supplierSku: sku,
      externalId: dto.externalId ?? existing?.externalId ?? null,
      supplierCost: (dto.costPaise / 100).toFixed(2),
      supplierShippingCost:
        dto.shippingPaise != null
          ? (dto.shippingPaise / 100).toFixed(2)
          : existing?.supplierShippingCost ?? null,
      inStock: dto.inStock ?? existing?.inStock ?? null,
      stockQty: dto.qty ?? existing?.stockQty ?? null,
      raw: mergedRaw as object,
      lastSyncedAt: new Date(),
    };

    let savedRow: SupplierProduct;
    if (existing) {
      savedRow = await prisma.supplierProduct.update({
        where: { id: existing.id },
        data,
      });
      totals.updated += 1;

      // If already mapped to a catalog Product, safely sync updated supplier cost & reprice
      if (savedRow.productId && dto.costPaise > 0) {
        try {
          await prisma.product.update({
            where: { id: savedRow.productId },
            data: {
              supplierCost: data.supplierCost,
              ...(data.supplierShippingCost !== null
                ? { supplierShippingCost: data.supplierShippingCost }
                : {}),
              ...(savedRow.stockQty !== null ? { stock: savedRow.stockQty } : {}),
            },
          });
          const repriced = await applyEnginePricingToProduct(savedRow.productId);
          if (repriced.applied) totals.repricedMappedProducts += 1;
          if (repriced.marginPercent < settings.pricing.minMarginPercent) {
            totals.marginAlertsCount += 1;
          }
        } catch (err) {
          logger.warn('Failed to reprice mapped product during supplier sync', {
            productId: savedRow.productId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } else {
      savedRow = await prisma.supplierProduct.create({
        data: { supplierId: supplier.id, ...data },
      });
      totals.created += 1;
    }

    syncedSupplierProductIds.push(savedRow.id);
  }

  // Evaluate all synced SupplierProduct rows and optionally auto-import / auto-publish
  const shouldAutoImport = params.autoImport ?? settings.autoImport.enabled;
  const shouldAutoPublish =
    params.autoPublishEligible ?? settings.autoImport.autoPublishEligible;
  let importedToday = await getTodayAutoImportCount();
  const dailyLimit = settings.autoImport.dailyImportLimit ?? 100;

  const syncedRows = await prisma.supplierProduct.findMany({
    where: { id: { in: syncedSupplierProductIds } },
    include: {
      supplier: true,
      product: { select: { id: true, slug: true, status: true } },
    },
  });

  for (const sp of syncedRows) {
    const { meta, pricing, evaluation } = evaluateSupplierProductCandidate({
      sp,
      settings,
      activeRules,
    });
    tierCounts[evaluation.tier] = (tierCounts[evaluation.tier] ?? 0) + 1;

    if (!meta.images.length || !meta.description) {
      totals.skippedIncomplete += 1;
    }

    // Already mapped to a catalog product
    if (sp.productId && sp.product) {
      const importStatus = sp.product.status === 'ACTIVE' ? 'PUBLISHED' : 'DRAFT';
      await prisma.supplierProduct.update({
        where: { id: sp.id },
        data: {
          raw: buildUpdatedRaw(sp.raw, meta, evaluation, {
            status: importStatus,
            reasons: [evaluation.summary],
            productId: sp.productId,
            updatedAt: new Date().toISOString(),
          }),
        },
      });
      reportItems.push({
        supplierProductId: sp.id,
        sku: sp.supplierSku,
        externalId: sp.externalId,
        name: meta.name,
        outcome: 'UPDATED_EXISTING',
        tier: evaluation.tier,
        score: evaluation.score,
        sellingPricePaise: pricing.sellingPricePaise,
        grossMarginPercent: pricing.effectiveMarginPercent,
        reasons: [evaluation.summary],
        productId: sp.productId,
      });
      continue;
    }

    // Unmapped product: if autoImport is enabled and within daily limit, run import pipeline
    if (shouldAutoImport && importedToday < dailyLimit) {
      try {
        const res = await importOrPublishSupplierProduct({
          supplierProductId: sp.id,
          allowAutoPublish: shouldAutoPublish,
          actor: params.actor,
        });
        if (res.outcome === 'PUBLISHED') {
          totals.autoImported += 1;
          totals.autoPublished += 1;
          importedToday += 1;
        } else if (res.outcome === 'SAVED_AS_DRAFT') {
          totals.autoImported += 1;
          totals.savedAsDraft += 1;
          importedToday += 1;
        } else if (res.outcome === 'HELD_FOR_REVIEW') {
          totals.autoImported += 1;
          totals.heldForReview += 1;
          totals.savedAsDraft += 1;
          importedToday += 1;
        } else if (res.outcome === 'REJECTED') {
          totals.rejected += 1;
        }
        reportItems.push({
          supplierProductId: sp.id,
          sku: sp.supplierSku,
          externalId: sp.externalId,
          name: meta.name,
          outcome:
            res.outcome === 'ALREADY_MAPPED' ? 'UPDATED_EXISTING' : res.outcome,
          tier: res.evaluation.tier,
          score: res.evaluation.score,
          sellingPricePaise: res.sellingPricePaise,
          grossMarginPercent: pricing.effectiveMarginPercent,
          reasons: res.reasons,
          productId: res.productId,
        });
      } catch (err) {
        totals.failed += 1;
        reportItems.push({
          supplierProductId: sp.id,
          sku: sp.supplierSku,
          externalId: sp.externalId,
          name: meta.name,
          outcome: 'SKIPPED_INVALID',
          tier: evaluation.tier,
          score: evaluation.score,
          reasons: [err instanceof Error ? err.message : String(err)],
        });
      }
    } else {
      // Save evaluation without importing into Product table yet
      const stateStatus =
        evaluation.tier === 'NOT_ELIGIBLE'
          ? 'REJECTED'
          : evaluation.eligibleForAutoPublish
            ? 'UNMAPPED'
            : 'NEEDS_REVIEW';
      if (stateStatus === 'REJECTED') totals.rejected += 1;
      else if (stateStatus === 'NEEDS_REVIEW') totals.heldForReview += 1;

      await prisma.supplierProduct.update({
        where: { id: sp.id },
        data: {
          raw: buildUpdatedRaw(sp.raw, meta, evaluation, {
            status: stateStatus,
            reasons:
              evaluation.blockingReasons.length > 0
                ? evaluation.blockingReasons
                : evaluation.publicationBlockers,
            productId: null,
            updatedAt: new Date().toISOString(),
          }),
        },
      });

      reportItems.push({
        supplierProductId: sp.id,
        sku: sp.supplierSku,
        externalId: sp.externalId,
        name: meta.name,
        outcome: stateStatus === 'REJECTED' ? 'REJECTED' : 'HELD_FOR_REVIEW',
        tier: evaluation.tier,
        score: evaluation.score,
        sellingPricePaise: pricing.sellingPricePaise,
        grossMarginPercent: pricing.effectiveMarginPercent,
        reasons:
          evaluation.blockingReasons.length > 0
            ? evaluation.blockingReasons
            : evaluation.publicationBlockers.length > 0
              ? evaluation.publicationBlockers
              : [evaluation.summary],
      });
    }
  }

  const completedAt = new Date().toISOString();
  await saveSupplierSyncCheckpoint({
    supplierId: supplier.id,
    inProgress: false,
    cursor: null,
    source: 'completed',
    pageNum: 1,
    fetchedCount: fetched.length,
    startedAt,
    updatedAt: completedAt,
    lastError: null,
  });

  const report: SupplierSyncReport = {
    supplierId: supplier.id,
    supplierName: supplier.name,
    supplierType: supplier.type,
    startedAt,
    completedAt,
    status: totals.failed > 0 ? 'PARTIAL_FAILURE' : 'COMPLETED',
    resumedFromCursor: resumeCursor,
    lastCursor,
    errorMessage: syncError,
    totals,
    tierCounts,
    items: reportItems.slice(0, 100),
  };

  await saveSupplierSyncReport(report);
  revalidateCatalog();

  await auditLog({
    actor: params.actor,
    action: 'supplier.catalog_synced',
    entityType: 'Supplier',
    entityId: supplier.id,
    data: {
      fetched: totals.discovered,
      created: totals.created,
      updated: totals.updated,
      skippedNoCost: totals.skippedNoCost,
      skippedDuplicate: totals.skippedDuplicate,
      autoImported: totals.autoImported,
      autoPublished: totals.autoPublished,
      savedAsDraft: totals.savedAsDraft,
      heldForReview: totals.heldForReview,
      rejected: totals.rejected,
      tierCounts,
    },
  });

  return report;
}

/**
 * Bulk-evaluates and optionally imports or safely publishes eligible supplier
 * products. Never publishes a product that fails any publication quality gate.
 */
export async function bulkProcessSupplierProducts(params: {
  supplierProductIds?: string[];
  mode: 'EVALUATE_ONLY' | 'IMPORT_ELIGIBLE_DRAFT' | 'SAFE_PUBLISH_ELIGIBLE';
  actor: Actor;
}): Promise<{
  evaluated: number;
  importedDraft: number;
  published: number;
  heldForReview: number;
  rejected: number;
  items: SupplierSyncReportItem[];
}> {
  const where = params.supplierProductIds?.length
    ? { id: { in: params.supplierProductIds } }
    : {};
  const rows = await prisma.supplierProduct.findMany({
    where,
    include: {
      supplier: true,
      product: { select: { id: true, slug: true, status: true, _count: { select: { images: true } } } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });

  const [settings, activeRules] = await Promise.all([
    getSettings(),
    prisma.pricingRule.findMany({ where: { isActive: true } }),
  ]);

  let evaluated = 0;
  let importedDraft = 0;
  let published = 0;
  let heldForReview = 0;
  let rejected = 0;
  const items: SupplierSyncReportItem[] = [];

  for (const sp of rows) {
    evaluated += 1;
    const { meta, pricing, evaluation } = evaluateSupplierProductCandidate({
      sp,
      settings,
      activeRules,
    });

    if (params.mode === 'EVALUATE_ONLY') {
      const currentStatus = sp.product
        ? sp.product.status === 'ACTIVE'
          ? 'PUBLISHED'
          : 'DRAFT'
        : evaluation.tier === 'NOT_ELIGIBLE'
          ? 'REJECTED'
          : evaluation.eligibleForAutoPublish
            ? 'UNMAPPED'
            : 'NEEDS_REVIEW';
      if (currentStatus === 'REJECTED') rejected += 1;
      else if (currentStatus === 'NEEDS_REVIEW') heldForReview += 1;

      await prisma.supplierProduct.update({
        where: { id: sp.id },
        data: {
          raw: buildUpdatedRaw(sp.raw, meta, evaluation, {
            status: currentStatus,
            reasons:
              evaluation.blockingReasons.length > 0
                ? evaluation.blockingReasons
                : evaluation.publicationBlockers,
            productId: sp.productId,
            updatedAt: new Date().toISOString(),
          }),
        },
      });
      items.push({
        supplierProductId: sp.id,
        sku: sp.supplierSku,
        externalId: sp.externalId,
        name: meta.name,
        outcome: currentStatus === 'REJECTED' ? 'REJECTED' : 'HELD_FOR_REVIEW',
        tier: evaluation.tier,
        score: evaluation.score,
        sellingPricePaise: pricing.sellingPricePaise,
        grossMarginPercent: pricing.effectiveMarginPercent,
        reasons: [evaluation.summary],
        productId: sp.productId,
      });
      continue;
    }

    // If already mapped to a DRAFT product and mode is SAFE_PUBLISH_ELIGIBLE,
    // promote to ACTIVE only if all quality gates pass!
    if (sp.productId && sp.product) {
      if (
        params.mode === 'SAFE_PUBLISH_ELIGIBLE' &&
        sp.product.status === 'DRAFT' &&
        evaluation.eligibleForAutoPublish &&
        // Same rule as productInputSchema: never promote a listing that has
        // no image on the product itself (an admin may have removed them
        // since import, even if the supplier metadata still lists some).
        sp.product._count.images > 0
      ) {
        await prisma.product.update({
          where: { id: sp.productId },
          data: { status: 'ACTIVE' },
        });
        await prisma.supplierProduct.update({
          where: { id: sp.id },
          data: {
            raw: buildUpdatedRaw(sp.raw, meta, evaluation, {
              status: 'PUBLISHED',
              reasons: [evaluation.summary],
              productId: sp.productId,
              updatedAt: new Date().toISOString(),
            }),
          },
        });
        published += 1;
        items.push({
          supplierProductId: sp.id,
          sku: sp.supplierSku,
          externalId: sp.externalId,
          name: meta.name,
          outcome: 'PUBLISHED',
          tier: evaluation.tier,
          score: evaluation.score,
          sellingPricePaise: pricing.sellingPricePaise,
          grossMarginPercent: pricing.effectiveMarginPercent,
          reasons: ['Promoted from DRAFT to ACTIVE after passing all quality gates.'],
          productId: sp.productId,
        });
      } else if (
        params.mode === 'SAFE_PUBLISH_ELIGIBLE' &&
        sp.product.status === 'DRAFT' &&
        evaluation.eligibleForAutoPublish
      ) {
        // Eligible by supplier data but the catalog product has no image →
        // surface it instead of silently skipping.
        heldForReview += 1;
        items.push({
          supplierProductId: sp.id,
          sku: sp.supplierSku,
          externalId: sp.externalId,
          name: meta.name,
          outcome: 'HELD_FOR_REVIEW',
          tier: evaluation.tier,
          score: evaluation.score,
          sellingPricePaise: pricing.sellingPricePaise,
          grossMarginPercent: pricing.effectiveMarginPercent,
          reasons: ['Product has no images in the catalog; add at least one image before publishing.'],
          productId: sp.productId,
        });
      }
      continue;
    }

    // Unmapped product
    const res = await importOrPublishSupplierProduct({
      supplierProductId: sp.id,
      allowAutoPublish: params.mode === 'SAFE_PUBLISH_ELIGIBLE',
      forceDraft: params.mode === 'IMPORT_ELIGIBLE_DRAFT',
      actor: params.actor,
    });
    if (res.outcome === 'PUBLISHED') published += 1;
    else if (res.outcome === 'SAVED_AS_DRAFT') importedDraft += 1;
    else if (res.outcome === 'HELD_FOR_REVIEW') {
      heldForReview += 1;
      importedDraft += 1;
    } else if (res.outcome === 'REJECTED') rejected += 1;

    items.push({
      supplierProductId: sp.id,
      sku: sp.supplierSku,
      externalId: sp.externalId,
      name: meta.name,
      outcome: res.outcome === 'ALREADY_MAPPED' ? 'UPDATED_EXISTING' : res.outcome,
      tier: res.evaluation.tier,
      score: res.evaluation.score,
      sellingPricePaise: res.sellingPricePaise,
      grossMarginPercent: pricing.effectiveMarginPercent,
      reasons: res.reasons,
      productId: res.productId,
    });
  }

  revalidateCatalog();
  return { evaluated, importedDraft, published, heldForReview, rejected, items };
}
