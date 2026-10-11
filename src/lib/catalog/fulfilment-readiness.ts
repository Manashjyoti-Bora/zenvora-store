import { prisma } from '../db';
import { getSettings } from '../settings';
import { toPaise } from '../money';
import { resolvePricing } from '../pricing/resolve';
import { extractSupplierProductMetadata } from './auto-import';

/**
 * ============================================================================
 * FULFILMENT READINESS & MARGIN ALERT REPORTING
 * ============================================================================
 *
 * Audits sellable (`ACTIVE`) and `DRAFT` catalog products to verify:
 *  1. Supplier linkage (`supplierId` + active `Supplier` record).
 *  2. CJ / Supplier product & variant mapping (`pid` / `vid` / `supplierSku`).
 *  3. Variant-level SKU mapping when a product has multiple active variants.
 *  4. Positive verified supplier cost and non-zero stock/availability.
 *  5. Margin protection alerts when supplier costs have eroded gross margin
 *     below `settings.pricing.minMarginPercent` or caused negative net profit.
 */

export interface FulfilmentReadinessItem {
  productId: string;
  name: string;
  slug: string;
  sku: string | null;
  status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
  stockMode: 'LOCAL' | 'SUPPLIER_SYNC';
  localStock: number;
  supplierId: string | null;
  supplierName: string | null;
  supplierType: string | null;
  supplierActive: boolean;
  supplierSku: string | null;
  externalId: string | null;
  variantId: string | null;
  activeVariantCount: number;
  unmappedVariantCount: number;
  ready: boolean;
  readinessMode: 'SUPPLIER_READY' | 'LOCAL_STOCK_READY' | 'NOT_READY';
  issues: string[];
  sellingPricePaise: number;
  landedCostPaise: number;
  effectiveMarginPercent: number;
  estimatedNetProfitPaise: number;
  marginAlert: boolean;
  marginAlertReason: string | null;
}

export interface FulfilmentReadinessReport {
  generatedAt: string;
  safetyMode: {
    supplierLiveOrderingEnabled: boolean;
    demoMode: boolean;
    statusLabel: string;
  };
  summary: {
    totalEvaluated: number;
    totalSellable: number;
    sellableReady: number;
    sellableNotReady: number;
    supplierReadyCount: number;
    localStockReadyCount: number;
    marginAlertCount: number;
    missingCostCount: number;
    missingShippingCount: number;
    missingImagesCount: number;
  };
  items: FulfilmentReadinessItem[];
}

export async function getFulfilmentReadinessReport(opts?: {
  includeDrafts?: boolean;
}): Promise<FulfilmentReadinessReport> {
  const settings = await getSettings();
  const statuses: Array<'ACTIVE' | 'DRAFT'> = opts?.includeDrafts
    ? ['ACTIVE', 'DRAFT']
    : ['ACTIVE'];

  const [products, supplierProducts] = await Promise.all([
    prisma.product.findMany({
      where: { status: { in: statuses } },
      include: {
        supplier: true,
        images: { select: { id: true, url: true } },
        variants: { where: { isActive: true } },
        supplierProduct: true,
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: 300,
    }),
    prisma.supplierProduct.findMany({
      select: {
        id: true,
        supplierId: true,
        productId: true,
        supplierSku: true,
        externalId: true,
        supplierCost: true,
        supplierShippingCost: true,
        inStock: true,
        stockQty: true,
        raw: true,
      },
      take: 500,
    }),
  ]);

  const spBySupplierAndSku = new Map<string, (typeof supplierProducts)[number]>();
  for (const sp of supplierProducts) {
    spBySupplierAndSku.set(`${sp.supplierId}:${sp.supplierSku.toLowerCase()}`, sp);
  }

  let totalSellable = 0;
  let sellableReady = 0;
  let sellableNotReady = 0;
  let supplierReadyCount = 0;
  let localStockReadyCount = 0;
  let marginAlertCount = 0;
  let missingCostCount = 0;
  let missingShippingCount = 0;
  let missingImagesCount = 0;

  const items: FulfilmentReadinessItem[] = [];

  for (const p of products) {
    const isSellable = p.status === 'ACTIVE';
    if (isSellable) totalSellable += 1;

    const linkedSp =
      p.supplierProduct ??
      (p.supplierId && p.supplierSku
        ? spBySupplierAndSku.get(`${p.supplierId}:${p.supplierSku.toLowerCase()}`) ?? null
        : null);

    const spMeta = linkedSp ? extractSupplierProductMetadata(linkedSp) : null;

    const issues: string[] = [];
    const supplierCostPaise = toPaise(p.supplierCost);
    const supplierShippingPaise = toPaise(p.supplierShippingCost);
    const sellingPricePaise = toPaise(p.sellingPrice);

    if (supplierCostPaise <= 0) {
      missingCostCount += 1;
      issues.push('Supplier unit cost is ₹0 or missing.');
    }
    if (p.supplierId && linkedSp && linkedSp.supplierShippingCost === null && supplierShippingPaise <= 0) {
      missingShippingCount += 1;
      issues.push('Supplier shipping cost to India is unverified.');
    }
    if (p.images.length === 0) {
      missingImagesCount += 1;
      issues.push('Product has no images.');
    }

    const activeVariants = p.variants;
    const unmappedVariants = activeVariants.filter((v) => !v.sku || v.sku.trim().length === 0);

    let readinessMode: FulfilmentReadinessItem['readinessMode'] = 'NOT_READY';

    if (p.supplierId && p.supplier) {
      if (!p.supplier.isActive) {
        issues.push(`Supplier "${p.supplier.name}" is marked inactive.`);
      }
      if (!p.supplierSku || !p.supplierSku.trim()) {
        issues.push('Missing supplierSku on product.');
      }
      if (!linkedSp) {
        issues.push('No linked SupplierProduct record found for this supplier SKU.');
      } else if (linkedSp.inStock === false || (linkedSp.stockQty !== null && linkedSp.stockQty <= 0)) {
        issues.push('Supplier reports this SKU is currently out of stock.');
      }
      if (p.supplier.type === 'CJ') {
        const hasCjIdentifier = Boolean(
          linkedSp?.externalId || spMeta?.variantId || (p.supplierSku && p.supplierSku.trim())
        );
        if (!hasCjIdentifier) {
          issues.push('Missing CJ pid / vid / SKU mapping required for createOrderV2.');
        }
      }
      if (activeVariants.length > 0 && unmappedVariants.length > 0) {
        issues.push(
          `${unmappedVariants.length} active variant(s) are missing a variant SKU for supplier variant resolution.`
        );
      }

      if (
        p.supplier.isActive &&
        Boolean(p.supplierSku && p.supplierSku.trim()) &&
        Boolean(linkedSp) &&
        linkedSp?.inStock !== false &&
        (linkedSp?.stockQty === null || (linkedSp?.stockQty ?? 1) > 0) &&
        unmappedVariants.length === 0 &&
        supplierCostPaise > 0
      ) {
        readinessMode = 'SUPPLIER_READY';
      }
    } else if (p.stockMode === 'LOCAL') {
      const totalLocalStock =
        activeVariants.length > 0
          ? activeVariants.reduce((sum, v) => sum + Math.max(0, v.stock), 0)
          : p.stock;
      if (totalLocalStock > 0 && supplierCostPaise > 0) {
        readinessMode = 'LOCAL_STOCK_READY';
      } else {
        if (totalLocalStock <= 0) {
          issues.push('Local stock is 0 and no dropship supplier is mapped.');
        }
        if (!p.supplierId) {
          issues.push('No supplier mapped for automated dropship fulfilment.');
        }
      }
    } else {
      issues.push('Stock mode is SUPPLIER_SYNC, but no supplier is assigned.');
    }

    const ready = readinessMode !== 'NOT_READY';
    if (isSellable) {
      if (ready) sellableReady += 1;
      else sellableNotReady += 1;
    }
    if (readinessMode === 'SUPPLIER_READY') supplierReadyCount += 1;
    if (readinessMode === 'LOCAL_STOCK_READY') localStockReadyCount += 1;

    const { breakdown } = await resolvePricing(p);
    let marginAlert = false;
    let marginAlertReason: string | null = null;

    if (supplierCostPaise > 0) {
      if (breakdown.belowCost || sellingPricePaise <= breakdown.totalCostPaise) {
        marginAlert = true;
        marginAlertReason = 'Selling price is at or below landed cost.';
      } else if (breakdown.estimatedNetProfitPaise < 0) {
        marginAlert = true;
        marginAlertReason = 'Estimated net profit after payment gateway fees is negative.';
      } else if (breakdown.effectiveMarginPercent < settings.pricing.minMarginPercent) {
        marginAlert = true;
        marginAlertReason = `Effective margin (${breakdown.effectiveMarginPercent}%) is below store minimum (${settings.pricing.minMarginPercent}%).`;
      }
    }
    if (marginAlert) marginAlertCount += 1;

    items.push({
      productId: p.id,
      name: p.name,
      slug: p.slug,
      sku: p.sku,
      status: p.status,
      stockMode: p.stockMode,
      localStock: p.stock,
      supplierId: p.supplierId,
      supplierName: p.supplier?.name ?? null,
      supplierType: p.supplier?.type ?? null,
      supplierActive: p.supplier?.isActive ?? false,
      supplierSku: p.supplierSku,
      externalId: linkedSp?.externalId ?? null,
      variantId: spMeta?.variantId ?? null,
      activeVariantCount: activeVariants.length,
      unmappedVariantCount: unmappedVariants.length,
      ready,
      readinessMode,
      issues,
      sellingPricePaise,
      landedCostPaise: breakdown.totalCostPaise,
      effectiveMarginPercent: breakdown.effectiveMarginPercent,
      estimatedNetProfitPaise: breakdown.estimatedNetProfitPaise,
      marginAlert,
      marginAlertReason,
    });
  }

  const liveEnabled = Boolean(settings.autoImport?.supplierLiveOrderingEnabled);

  return {
    generatedAt: new Date().toISOString(),
    safetyMode: {
      supplierLiveOrderingEnabled: liveEnabled,
      demoMode: settings.demoMode,
      statusLabel: liveEnabled
        ? 'LIVE SUPPLIER ORDERING ENABLED'
        : 'SAFE DRY-RUN / DEMO MODE (Live CJ wallet debit disabled until explicitly authorized)',
    },
    summary: {
      totalEvaluated: items.length,
      totalSellable,
      sellableReady,
      sellableNotReady,
      supplierReadyCount,
      localStockReadyCount,
      marginAlertCount,
      missingCostCount,
      missingShippingCount,
      missingImagesCount,
    },
    items,
  };
}
