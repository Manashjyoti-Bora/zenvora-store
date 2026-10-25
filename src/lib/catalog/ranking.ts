import type { StoreSettings } from '../settings';
import { isSafeMediaUrl } from '../images/url-safety';
import type { SupplierVariantDto } from '../suppliers/types';

/**
 * ============================================================================
 * INDIAN RESELLING PRODUCT ELIGIBILITY & RANKING ENGINE
 * ============================================================================
 *
 * Deterministic, configurable, evidence-based product evaluation engine for
 * Indian e-commerce reselling.
 *
 * Honesty & non-fabrication guarantees:
 *  - Never uses random numbers or fabricated popularity/demand scores.
 *  - When demand/popularity data (real store orders or CJ listedNum) is absent,
 *    `demandConfidence` is explicitly reported as `'UNKNOWN'`.
 *  - All weights and thresholds come from `StoreSettings.autoImport` and
 *    `StoreSettings.pricing` (with safe defaults).
 *  - Every score factor produces a human-readable explanation and status
 *    (`pass`, `warn`, `fail`), plus exact `blockingReasons` whenever a product
 *    is ineligible for import or auto-publication.
 */

export type ProductRankingTier =
  | 'HIGH_POTENTIAL'
  | 'PROMISING'
  | 'NEEDS_REVIEW'
  | 'NOT_ELIGIBLE';

export type DemandConfidence = 'VERIFIED' | 'LOW_EVIDENCE' | 'UNKNOWN';

export interface RankingFactorBreakdown {
  key:
    | 'costAndMargin'
    | 'shippingAndFulfilment'
    | 'stockReliability'
    | 'contentAndImagery'
    | 'lowReturnRiskAndCompliance'
    | 'codAndMarketFit';
  label: string;
  score: number;
  maxScore: number;
  status: 'pass' | 'warn' | 'fail';
  explanation: string;
}

export interface ProductCandidateInput {
  supplierId?: string | null;
  supplierName?: string | null;
  supplierType?: string | null;
  supplierActive?: boolean;
  supplierSku?: string | null;
  externalId?: string | null;
  variantId?: string | null;

  name?: string | null;
  description?: string | null;
  shortDescription?: string | null;
  categoryName?: string | null;
  categorySlug?: string | null;
  brand?: string | null;
  images?: string[];
  specifications?: Record<string, string>;
  variants?: SupplierVariantDto[];

  supplierCostPaise: number | null;
  supplierShippingPaise: number | null;
  shippingKnown: boolean;
  otherCostPaise: number;
  sellingPricePaise: number;
  grossMarginPaise: number;
  effectiveMarginPercent: number;
  estimatedNetProfitPaise: number;

  inStock?: boolean | null;
  stockQty?: number | null;
  lastSyncedAt?: Date | string | null;

  weightGrams?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  shippingSupportedToIndia?: boolean | null;
  leadTimeDays?: { min: number; max: number } | null;

  /** Only populated when genuinely provided by CJ (`listedNum`) or store DB. */
  listedNum?: number | null;
  storeOrderCount?: number | null;
  storeViewCount?: number | null;

  isDuplicate?: boolean;
  duplicateReason?: string | null;
}

export interface ProductEvaluationResult {
  tier: ProductRankingTier;
  score: number;
  maxScore: number;
  demandConfidence: DemandConfidence;
  demandSummary: string;
  codSuitable: boolean;
  fulfilmentReady: boolean;
  compliancePassed: boolean;
  eligibleForImport: boolean;
  eligibleForAutoPublish: boolean;
  recommendedStatus: 'ACTIVE' | 'DRAFT';
  reviewState: 'PUBLISHED' | 'AUTO_READY' | 'NEEDS_REVIEW' | 'REJECTED';
  factors: RankingFactorBreakdown[];
  blockingReasons: string[];
  publicationBlockers: string[];
  warnings: string[];
  summary: string;
  evaluatedAt: string;
}

/**
 * Prohibited / restricted product patterns for Indian B2C e-commerce compliance
 * (weapons, vapes/e-cigarettes, prescription/scheduled drugs, counterfeit/replica
 * claims, hazardous materials, adult/gambling items).
 */
const PROHIBITED_POLICY_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern:
      /\b(tactical\s+knife|hunting\s+knife|survival\s+knife|switchblade|dagger|knuckle\s+duster|firearm|ammunition|pistol|rifle|taser|stun\s+gun|crossbow)\b/i,
    reason: 'Prohibited weapon or tactical blade under Indian courier and platform safety policy.',
  },
  {
    pattern: /\b(e-?cigarette|vape\s+pen|vaping|nicotine\s+liquid|e-?liquid|hookah\s+tobacco)\b/i,
    reason: 'Prohibited e-cigarette / nicotine product (PROHACT India compliance).',
  },
  {
    pattern:
      /\b(prescription\s+only|steroid|anabolic|sildenafil|tadalafil|scheduled\s+drug|narcotic|cannabis|thc\s+oil)\b/i,
    reason: 'Restricted pharmaceutical or controlled substance.',
  },
  {
    pattern:
      /\b(1:1\s+replica|first\s+copy|aaa\s+replica|counterfeit|fake\s+branded|knockoff)\b/i,
    reason: 'Counterfeit or unauthorized brand replica claim (IP compliance violation).',
  },
  {
    pattern: /\b(explosive|firecracker|flammable\s+liquid|corrosive\s+acid|radioactive)\b/i,
    reason: 'Hazardous material prohibited for standard air/surface courier fulfilment.',
  },
];

const FRAGILE_KEYWORDS = /\b(glass|ceramic|porcelain|crystal|mirror|terracotta|bone\s+china)\b/i;
const PLACEHOLDER_TEXT = /^(todo|tbd|placeholder|lorem ipsum|sample description|test product)\b/i;

export function checkProductCompliance(input: {
  name?: string | null;
  description?: string | null;
  categoryName?: string | null;
  brand?: string | null;
}): { passed: boolean; reasons: string[] } {
  const combined = [
    input.name ?? '',
    input.description ?? '',
    input.categoryName ?? '',
    input.brand ?? '',
  ].join(' ');
  const reasons: string[] = [];
  for (const rule of PROHIBITED_POLICY_PATTERNS) {
    if (rule.pattern.test(combined)) {
      reasons.push(rule.reason);
    }
  }
  return { passed: reasons.length === 0, reasons };
}

export function isValidProductImageUrl(url: string | null | undefined): boolean {
  // Delegates to the shared media-URL safety rule (https + public host, or
  // /uploads/). Kept under its historical name for existing call sites.
  return isSafeMediaUrl(url);
}

export function evaluateProductCandidate(
  candidate: ProductCandidateInput,
  settings: StoreSettings
): ProductEvaluationResult {
  const autoCfg = settings.autoImport;
  const weights = autoCfg.rankingWeights;

  const blockingReasons: string[] = [];
  const publicationBlockers: string[] = [];
  const warnings: string[] = [];

  const totalCostPaise =
    (candidate.supplierCostPaise ?? 0) +
    (candidate.supplierShippingPaise ?? 0) +
    candidate.otherCostPaise;

  // -------------------------------------------------------------------------
  // 1. Cost & Margin Viability
  // -------------------------------------------------------------------------
  const maxCostScore = weights.costAndMargin;
  let costScore = 0;
  let costStatus: 'pass' | 'warn' | 'fail' = 'pass';
  const costNotes: string[] = [];

  const minMarginPct = Math.max(autoCfg.minMarginPercent, settings.pricing.minMarginPercent);
  const minProfitPaise = Math.max(autoCfg.minProfitPaise, settings.pricing.minProfitPaise);

  if (candidate.supplierCostPaise == null || candidate.supplierCostPaise <= 0) {
    costStatus = 'fail';
    blockingReasons.push('Missing or zero verified supplier unit cost.');
    publicationBlockers.push('Missing or zero verified supplier unit cost.');
    costNotes.push('Supplier unit cost is missing or ₹0.');
  } else if (candidate.sellingPricePaise <= 0 || candidate.sellingPricePaise <= totalCostPaise) {
    costStatus = 'fail';
    blockingReasons.push('Selling price does not cover landed cost.');
    publicationBlockers.push('Selling price does not cover landed cost.');
    costNotes.push('Selling price is at or below landed cost.');
  } else if (
    autoCfg.maxLandedCostPaise > 0 &&
    totalCostPaise > autoCfg.maxLandedCostPaise
  ) {
    costStatus = 'fail';
    blockingReasons.push(
      `Landed cost (₹${(totalCostPaise / 100).toFixed(2)}) exceeds maximum allowed landed cost (₹${(
        autoCfg.maxLandedCostPaise / 100
      ).toFixed(2)}).`
    );
    publicationBlockers.push('Landed cost exceeds configured maximum.');
    costNotes.push('Landed cost exceeds store ceiling.');
  } else {
    // Base points for positive cost within bounds (30% of factor weight)
    let ratio = 0.3;

    // Landed cost sweet spot for Indian reselling: ₹100 – ₹3,500
    if (totalCostPaise <= 350_000) {
      ratio += 0.2;
      costNotes.push(`Landed cost ₹${(totalCostPaise / 100).toFixed(0)} is in the Indian sweet spot.`);
    } else {
      ratio += 0.1;
      costNotes.push(`Landed cost ₹${(totalCostPaise / 100).toFixed(0)} is higher-ticket.`);
    }

    // Margin & Net profit check
    const meetsMarginPct = candidate.effectiveMarginPercent >= minMarginPct;
    const meetsProfitFloor = candidate.grossMarginPaise >= minProfitPaise;
    const positiveNet = candidate.estimatedNetProfitPaise > 0;

    if (!positiveNet) {
      costStatus = 'fail';
      publicationBlockers.push('Estimated net profit after payment gateway fees is negative.');
      costNotes.push('Net profit after gateway fees is negative.');
    } else if (!meetsMarginPct || !meetsProfitFloor) {
      costStatus = 'warn';
      if (!meetsMarginPct) {
        publicationBlockers.push(
          `Effective gross margin (${candidate.effectiveMarginPercent.toFixed(1)}%) is below minimum (${minMarginPct}%).`
        );
      }
      if (!meetsProfitFloor) {
        publicationBlockers.push(
          `Gross profit (₹${(candidate.grossMarginPaise / 100).toFixed(2)}) is below minimum (₹${(
            minProfitPaise / 100
          ).toFixed(2)}).`
        );
      }
      ratio += 0.15;
      costNotes.push(
        `Margin ${candidate.effectiveMarginPercent.toFixed(1)}% / profit ₹${(
          candidate.grossMarginPaise / 100
        ).toFixed(0)} is below auto-publish target.`
      );
    } else {
      // Scale remaining 0.50 by how strong margin is above minMarginPct
      const bonus = Math.min(0.5, 0.3 + ((candidate.effectiveMarginPercent - minMarginPct) / 40) * 0.2);
      ratio += bonus;
      costNotes.push(
        `Healthy ${candidate.effectiveMarginPercent.toFixed(1)}% gross margin (₹${(
          candidate.grossMarginPaise / 100
        ).toFixed(0)} gross, ₹${(candidate.estimatedNetProfitPaise / 100).toFixed(0)} est. net).`
      );
    }

    // Selling price bounds check
    if (
      autoCfg.minSellingPricePaise > 0 &&
      candidate.sellingPricePaise < autoCfg.minSellingPricePaise
    ) {
      costStatus = 'warn';
      publicationBlockers.push(
        `Selling price (₹${(candidate.sellingPricePaise / 100).toFixed(2)}) is below minimum (₹${(
          autoCfg.minSellingPricePaise / 100
        ).toFixed(2)}).`
      );
    }
    if (
      autoCfg.maxSellingPricePaise > 0 &&
      candidate.sellingPricePaise > autoCfg.maxSellingPricePaise
    ) {
      costStatus = 'warn';
      publicationBlockers.push(
        `Selling price (₹${(candidate.sellingPricePaise / 100).toFixed(2)}) exceeds maximum auto-publish price (₹${(
          autoCfg.maxSellingPricePaise / 100
        ).toFixed(2)}).`
      );
    }

    costScore = Math.round(maxCostScore * Math.min(1, Math.max(0, ratio)));
  }

  // -------------------------------------------------------------------------
  // 2. Shipping & India Fulfilment Feasibility
  // -------------------------------------------------------------------------
  const maxShipScore = weights.shippingAndFulfilment;
  let shipScore = 0;
  let shipStatus: 'pass' | 'warn' | 'fail' = 'pass';
  const shipNotes: string[] = [];

  const hasSupplierIdentity = Boolean(
    candidate.supplierId &&
      candidate.supplierActive !== false &&
      candidate.supplierSku &&
      candidate.supplierSku.trim().length > 0
  );
  const hasFulfilmentMapping =
    hasSupplierIdentity &&
    (candidate.supplierType !== 'CJ' ||
      Boolean(candidate.externalId || candidate.variantId || candidate.supplierSku));

  if (!hasSupplierIdentity) {
    shipStatus = 'fail';
    publicationBlockers.push('Missing active supplier or supplier SKU mapping.');
    shipNotes.push('No active supplier / SKU mapping.');
  } else if (candidate.shippingSupportedToIndia === false) {
    shipStatus = 'fail';
    blockingReasons.push('Supplier reports shipping to India (IN) is not supported for this item.');
    publicationBlockers.push('Shipping to India (IN) is not supported.');
    shipNotes.push('India shipping unsupported.');
  } else {
    let ratio = 0.4; // Active supplier + SKU mapped
    if (!candidate.shippingKnown || candidate.supplierShippingPaise == null) {
      shipStatus = 'warn';
      publicationBlockers.push(
        'Supplier shipping cost to India is unverified; requires manual review before going live.'
      );
      warnings.push('Supplier freight cost to India is not verified on this record.');
      shipNotes.push('Supplier SKU mapped, but freight cost to India is unverified.');
    } else {
      ratio += 0.35;
      const shipToCostRatio =
        candidate.supplierCostPaise && candidate.supplierCostPaise > 0
          ? candidate.supplierShippingPaise / candidate.supplierCostPaise
          : 0;
      if (shipToCostRatio <= 0.35) {
        ratio += 0.25;
        shipNotes.push(
          `Verified shipping ₹${(candidate.supplierShippingPaise / 100).toFixed(0)} (${Math.round(
            shipToCostRatio * 100
          )}% of product cost).`
        );
      } else if (shipToCostRatio <= 0.75) {
        ratio += 0.12;
        shipNotes.push(
          `Verified shipping ₹${(candidate.supplierShippingPaise / 100).toFixed(0)} is moderate (${Math.round(
            shipToCostRatio * 100
          )}% of product cost).`
        );
      } else {
        shipStatus = 'warn';
        warnings.push('Shipping cost is high relative to product unit cost (>75%).');
        shipNotes.push(
          `Shipping ₹${(candidate.supplierShippingPaise / 100).toFixed(0)} is heavy relative to product cost.`
        );
      }
    }
    shipScore = Math.round(maxShipScore * Math.min(1, ratio));
  }

  // -------------------------------------------------------------------------
  // 3. Stock & Variant Reliability
  // -------------------------------------------------------------------------
  const maxStockScore = weights.stockReliability;
  let stockScore = 0;
  let stockStatus: 'pass' | 'warn' | 'fail' = 'pass';
  const stockNotes: string[] = [];

  if (
    candidate.inStock === false ||
    (candidate.stockQty !== null && candidate.stockQty !== undefined && candidate.stockQty <= 0)
  ) {
    stockStatus = 'fail';
    blockingReasons.push('Supplier reports this product is currently out of stock.');
    publicationBlockers.push('Supplier reports this product is out of stock.');
    stockNotes.push('Out of stock at supplier.');
  } else if (candidate.stockQty != null && candidate.stockQty >= 20) {
    stockScore = maxStockScore;
    stockNotes.push(`Strong verified supplier stock (${candidate.stockQty} units).`);
  } else if (candidate.stockQty != null && candidate.stockQty >= 5) {
    stockScore = Math.round(maxStockScore * 0.75);
    stockNotes.push(`Moderate verified supplier stock (${candidate.stockQty} units).`);
  } else if (candidate.stockQty != null && candidate.stockQty > 0) {
    stockStatus = 'warn';
    stockScore = Math.round(maxStockScore * 0.45);
    warnings.push(`Low supplier stock (${candidate.stockQty} units).`);
    stockNotes.push(`Low supplier stock (${candidate.stockQty} units).`);
  } else if (candidate.inStock === true) {
    stockScore = Math.round(maxStockScore * 0.7);
    stockNotes.push('Supplier reports in-stock (exact warehouse quantity not specified).');
  } else {
    stockStatus = 'warn';
    stockScore = Math.round(maxStockScore * 0.25);
    warnings.push('Supplier stock availability is unverified.');
    stockNotes.push('Stock status unverified.');
    if (autoCfg.requireVerifiedStock) {
      publicationBlockers.push('Verified positive supplier stock is required for auto-publication.');
    }
  }

  // -------------------------------------------------------------------------
  // 4. Product Content, Imagery & Specifications
  // -------------------------------------------------------------------------
  const maxContentScore = weights.contentAndImagery;
  let contentScore = 0;
  let contentStatus: 'pass' | 'warn' | 'fail' = 'pass';
  const contentNotes: string[] = [];

  const validImages = (candidate.images ?? []).filter(isValidProductImageUrl);
  const titleClean = (candidate.name ?? '').trim();
  const descClean = (candidate.description ?? '').trim();
  const specCount = Object.keys(candidate.specifications ?? {}).length;

  let contentRatio = 0;
  if (titleClean.length < 3 || PLACEHOLDER_TEXT.test(titleClean)) {
    contentStatus = 'fail';
    blockingReasons.push('Product title is missing or placeholder text.');
    publicationBlockers.push('Product title is missing or placeholder text.');
    contentNotes.push('Missing/invalid title.');
  } else {
    contentRatio += 0.25;
  }

  if (validImages.length >= 2) {
    contentRatio += 0.4;
    contentNotes.push(`${validImages.length} valid images.`);
  } else if (validImages.length === 1) {
    contentRatio += 0.3;
    contentNotes.push('1 valid product image.');
  } else {
    contentStatus = 'warn';
    warnings.push('Product has no valid images.');
    contentNotes.push('No valid product images.');
    if (autoCfg.requireValidImages) {
      publicationBlockers.push('At least 1 valid product image is required before publication.');
    }
  }

  if (descClean.length >= autoCfg.minDescriptionLength && !PLACEHOLDER_TEXT.test(descClean)) {
    contentRatio += 0.25;
    contentNotes.push(`Complete description (${descClean.length} chars).`);
  } else {
    if (contentStatus === 'pass') contentStatus = 'warn';
    publicationBlockers.push(
      `Product description is missing or shorter than ${autoCfg.minDescriptionLength} characters.`
    );
    warnings.push('Description is missing or too brief for storefront publication.');
    contentNotes.push('Description missing or too short.');
  }

  if (specCount > 0 || (candidate.weightGrams != null && candidate.weightGrams > 0)) {
    contentRatio += 0.1;
    contentNotes.push('Specifications/weight present.');
  }

  contentScore = Math.round(maxContentScore * Math.min(1, contentRatio));

  // -------------------------------------------------------------------------
  // 5. Return Risk, Logistics Weight & Compliance
  // -------------------------------------------------------------------------
  const maxRiskScore = weights.lowReturnRiskAndCompliance;
  let riskScore = 0;
  let riskStatus: 'pass' | 'warn' | 'fail' = 'pass';
  const riskNotes: string[] = [];

  const compliance = checkProductCompliance({
    name: candidate.name,
    description: candidate.description,
    categoryName: candidate.categoryName,
    brand: candidate.brand,
  });

  if (!compliance.passed) {
    riskStatus = 'fail';
    for (const reason of compliance.reasons) {
      blockingReasons.push(reason);
      publicationBlockers.push(reason);
    }
    riskNotes.push(compliance.reasons.join(' '));
  } else {
    let riskRatio = 0.6; // Passed compliance check
    riskNotes.push('Passed safety & policy compliance check.');

    const combinedText = `${candidate.name ?? ''} ${candidate.description ?? ''}`;
    if (FRAGILE_KEYWORDS.test(combinedText)) {
      riskStatus = 'warn';
      warnings.push('Fragile material detected (glass/ceramic/mirror) — higher transit damage risk.');
      riskNotes.push('Fragile material flagged.');
      riskRatio += 0.1;
    } else {
      riskRatio += 0.2;
    }

    if (candidate.weightGrams != null && candidate.weightGrams > 0) {
      if (candidate.weightGrams <= 1500) {
        riskRatio += 0.2;
        riskNotes.push(`Courier-friendly weight (${candidate.weightGrams} g).`);
      } else if (candidate.weightGrams <= 4000) {
        riskRatio += 0.1;
        riskNotes.push(`Medium weight (${candidate.weightGrams} g).`);
      } else {
        riskStatus = 'warn';
        warnings.push(`Heavy parcel (${candidate.weightGrams} g) may incur higher courier slabs.`);
        riskNotes.push(`Heavy weight (${candidate.weightGrams} g).`);
      }
    } else {
      riskRatio += 0.15;
    }

    riskScore = Math.round(maxRiskScore * Math.min(1, riskRatio));
  }

  // -------------------------------------------------------------------------
  // 6. COD Suitability & Category / Market Fit
  // -------------------------------------------------------------------------
  const maxCodScore = weights.codAndMarketFit;
  let codScore = 0;
  let codStatus: 'pass' | 'warn' | 'fail' = 'pass';
  const codNotes: string[] = [];

  const catNorm = (candidate.categorySlug ?? candidate.categoryName ?? '').trim().toLowerCase();
  const excluded = autoCfg.excludedCategories.map((c) => c.trim().toLowerCase()).filter(Boolean);
  const allowed = autoCfg.allowedCategories.map((c) => c.trim().toLowerCase()).filter(Boolean);

  if (catNorm && excluded.some((ex) => catNorm.includes(ex))) {
    codStatus = 'fail';
    const msg = `Category "${candidate.categoryName ?? candidate.categorySlug}" is in the excluded categories list.`;
    blockingReasons.push(msg);
    publicationBlockers.push(msg);
    codNotes.push(msg);
  } else if (allowed.length > 0 && (!catNorm || !allowed.some((al) => catNorm.includes(al)))) {
    codStatus = 'warn';
    const msg = `Category "${candidate.categoryName || 'Uncategorized'}" is not in the allowed auto-publish categories list.`;
    publicationBlockers.push(msg);
    codNotes.push(msg);
  } else {
    const codMax = autoCfg.codMaxPricePaise > 0 ? autoCfg.codMaxPricePaise : 500_000;
    const codSuitable =
      candidate.sellingPricePaise >= 15_000 &&
      candidate.sellingPricePaise <= codMax &&
      candidate.effectiveMarginPercent >= minMarginPct;

    if (codSuitable) {
      codScore = maxCodScore;
      codNotes.push(
        `Suitable for Indian COD & prepaid orders (price ₹${(
          candidate.sellingPricePaise / 100
        ).toFixed(0)} ≤ ₹${(codMax / 100).toFixed(0)} COD ceiling).`
      );
    } else {
      codStatus = 'warn';
      codScore = Math.round(maxCodScore * 0.5);
      codNotes.push(
        candidate.sellingPricePaise > codMax
          ? `Price ₹${(candidate.sellingPricePaise / 100).toFixed(0)} exceeds COD sweet-spot ceiling (₹${(
              codMax / 100
            ).toFixed(0)}); recommended for prepaid.`
          : 'Margin or price outside ideal COD buffer.'
      );
    }
  }

  // Duplicate check
  if (candidate.isDuplicate) {
    const dupMsg = candidate.duplicateReason ?? 'Duplicate of an existing catalog product.';
    publicationBlockers.push(dupMsg);
    warnings.push(dupMsg);
  }

  // -------------------------------------------------------------------------
  // Demand Confidence (NEVER invented or randomized)
  // -------------------------------------------------------------------------
  let demandConfidence: DemandConfidence = 'UNKNOWN';
  let demandSummary =
    'Demand confidence: UNKNOWN — no verified store order history or CJ listedNum metric available; ranked strictly on verified cost, margin, stock, shipping and product completeness.';
  const verifiedMinListed = autoCfg.verifiedDemandMinListedNum ?? 20;
  if ((candidate.storeOrderCount ?? 0) > 0 || (candidate.listedNum ?? 0) >= verifiedMinListed) {
    demandConfidence = 'VERIFIED';
    const parts: string[] = [];
    if ((candidate.storeOrderCount ?? 0) > 0) {
      parts.push(`${candidate.storeOrderCount} store order(s)`);
    }
    if ((candidate.listedNum ?? 0) > 0) {
      parts.push(`CJ listedNum=${candidate.listedNum}`);
    }
    demandSummary = `Demand confidence: VERIFIED (${parts.join(', ')}).`;
  } else if ((candidate.listedNum ?? 0) > 0 || (candidate.storeViewCount ?? 0) >= 10) {
    demandConfidence = 'LOW_EVIDENCE';
    demandSummary = `Demand confidence: LOW_EVIDENCE (limited signal: ${
      candidate.listedNum ? `CJ listedNum=${candidate.listedNum}` : `${candidate.storeViewCount} views`
    }).`;
  }

  // -------------------------------------------------------------------------
  // Total Normalized Score (0..100) & Tier Classification
  // -------------------------------------------------------------------------
  const factors: RankingFactorBreakdown[] = [
    {
      key: 'costAndMargin',
      label: 'Cost & Margin Viability',
      score: costScore,
      maxScore: maxCostScore,
      status: costStatus,
      explanation: costNotes.join(' '),
    },
    {
      key: 'shippingAndFulfilment',
      label: 'Shipping & India Fulfilment',
      score: shipScore,
      maxScore: maxShipScore,
      status: shipStatus,
      explanation: shipNotes.join(' '),
    },
    {
      key: 'stockReliability',
      label: 'Supplier Stock Reliability',
      score: stockScore,
      maxScore: maxStockScore,
      status: stockStatus,
      explanation: stockNotes.join(' '),
    },
    {
      key: 'contentAndImagery',
      label: 'Images, Title & Specifications',
      score: contentScore,
      maxScore: maxContentScore,
      status: contentStatus,
      explanation: contentNotes.join(' '),
    },
    {
      key: 'lowReturnRiskAndCompliance',
      label: 'Compliance & Low Return Risk',
      score: riskScore,
      maxScore: maxRiskScore,
      status: riskStatus,
      explanation: riskNotes.join(' '),
    },
    {
      key: 'codAndMarketFit',
      label: 'Indian Market & COD Fit',
      score: codScore,
      maxScore: maxCodScore,
      status: codStatus,
      explanation: codNotes.join(' '),
    },
  ];

  const rawMax = factors.reduce((acc, f) => acc + f.maxScore, 0);
  const rawTotal = factors.reduce((acc, f) => acc + f.score, 0);
  const normalizedScore = rawMax > 0 ? Math.round((rawTotal / rawMax) * 100) : 0;

  // Confidence safeguard: owner-configured minimum demand evidence before a
  // candidate may be auto-published. Default UNKNOWN = no gate (unit economics
  // only). This never changes import eligibility — only publication.
  const confidenceRank: Record<DemandConfidence, number> = {
    UNKNOWN: 0,
    LOW_EVIDENCE: 1,
    VERIFIED: 2,
  };
  const minConfidence = autoCfg.minDemandConfidenceForAutoPublish ?? 'UNKNOWN';
  if (confidenceRank[demandConfidence] < confidenceRank[minConfidence]) {
    publicationBlockers.push(
      `Demand evidence ${demandConfidence} is below the configured minimum (${minConfidence}) for automatic publishing — hold for owner review.`
    );
  }

  const eligibleForImport = blockingReasons.length === 0;
  const eligibleForAutoPublish =
    eligibleForImport && publicationBlockers.length === 0 && !candidate.isDuplicate;

  const minScoreForPublish = autoCfg.minScoreForAutoPublish ?? 55;
  let tier: ProductRankingTier;
  if (!eligibleForImport) {
    tier = 'NOT_ELIGIBLE';
  } else if (!eligibleForAutoPublish) {
    tier = 'NEEDS_REVIEW';
  } else if (normalizedScore >= Math.max(75, minScoreForPublish)) {
    tier = 'HIGH_POTENTIAL';
  } else if (normalizedScore >= minScoreForPublish) {
    tier = 'PROMISING';
  } else {
    tier = 'NEEDS_REVIEW';
  }

  const codMax = autoCfg.codMaxPricePaise > 0 ? autoCfg.codMaxPricePaise : 500_000;
  const codSuitable =
    eligibleForImport &&
    candidate.sellingPricePaise >= 15_000 &&
    candidate.sellingPricePaise <= codMax &&
    candidate.effectiveMarginPercent >= minMarginPct;

  const recommendedStatus: 'ACTIVE' | 'DRAFT' =
    eligibleForAutoPublish && (tier === 'HIGH_POTENTIAL' || tier === 'PROMISING')
      ? 'ACTIVE'
      : 'DRAFT';

  const reviewState: ProductEvaluationResult['reviewState'] = !eligibleForImport
    ? 'REJECTED'
    : eligibleForAutoPublish
      ? 'AUTO_READY'
      : 'NEEDS_REVIEW';

  let summary: string;
  if (tier === 'NOT_ELIGIBLE') {
    summary = `Not eligible for Indian reselling (${normalizedScore}/100): ${blockingReasons.join(' ')}`;
  } else if (tier === 'NEEDS_REVIEW') {
    summary = `Held as Needs Review (${normalizedScore}/100): ${
      publicationBlockers.length > 0
        ? publicationBlockers.join(' ')
        : 'Score below automatic publication threshold.'
    }`;
  } else if (tier === 'HIGH_POTENTIAL') {
    summary = `High Potential (${normalizedScore}/100): verified landed cost ₹${(
      totalCostPaise / 100
    ).toFixed(0)}, ${candidate.effectiveMarginPercent.toFixed(
      1
    )}% gross margin, in stock, and complete product data.`;
  } else {
    summary = `Promising (${normalizedScore}/100): passes all publication quality gates with ${candidate.effectiveMarginPercent.toFixed(
      1
    )}% gross margin. ${demandSummary}`;
  }

  return {
    tier,
    score: normalizedScore,
    maxScore: 100,
    demandConfidence,
    demandSummary,
    codSuitable,
    fulfilmentReady: hasFulfilmentMapping && candidate.inStock !== false,
    compliancePassed: compliance.passed,
    eligibleForImport,
    eligibleForAutoPublish,
    recommendedStatus,
    reviewState,
    factors,
    blockingReasons,
    publicationBlockers,
    warnings,
    summary,
    evaluatedAt: new Date().toISOString(),
  };
}
