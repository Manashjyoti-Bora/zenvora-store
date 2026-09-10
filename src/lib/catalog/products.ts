import { z } from 'zod';
import { prisma } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import { auditLog } from '../audit';
import { slugify } from '../utils';
import { productInputSchema } from '../validation/schemas';
import { resolvePricing } from '../pricing/resolve';
import { minSafePricePaise } from '../pricing/calculations';
import { getSettings } from '../settings';
import type { Actor } from './types';

/**
 * Catalog service: create/update/archive products with the pricing engine
 * wired in. The stored `sellingPrice` is ALWAYS recomputed server-side from
 * cost + mode + applicable pricing rule - admins never hand-enter the final
 * number without seeing the engine preview (and the engine result wins).
 */

export type ProductInput = z.infer<typeof productInputSchema>;

const dec = (paise: number) => (paise / 100).toFixed(2);

export async function ensureUniqueSlug(base: string, ignoreId?: string): Promise<string> {
  const baseSlug = slugify(base) || 'product';
  let slug = baseSlug;
  for (let i = 2; ; i++) {
    const existing = await prisma.product.findUnique({ where: { slug } });
    if (!existing || existing.id === ignoreId) return slug;
    slug = `${baseSlug}-${i}`;
  }
}

export async function saveProduct(
  input: ProductInput,
  actor: Actor
): Promise<{ id: string; slug: string; sellingPricePaise: number }> {
  if (input.stockMode === 'LOCAL' && input.variants.length === 0 && input.status === 'ACTIVE') {
    // LOCAL stock without variants uses the product-level stock counter;
    // it is managed on the Inventory page. Nothing to reject - just documented.
  }

  const slug = await ensureUniqueSlug(input.slug || input.name, input.id);

  const productData = {
    name: input.name,
    slug,
    description: input.description,
    shortDescription: input.shortDescription || null,
    sku: input.sku || null,
    brand: input.brand || null,
    status: input.status,
    categoryId: input.categoryId || null,
    supplierId: input.supplierId || null,
    supplierSku: input.supplierSku || null,
    stockMode: input.stockMode,
    supplierCost: dec(input.supplierCost),
    supplierShippingCost: dec(input.supplierShippingCost ?? 0),
    otherCost: dec(input.otherCost ?? 0),
    pricingMode: input.pricingMode,
    fixedPrice: input.fixedPrice != null ? dec(input.fixedPrice) : null,
    fixedMargin: input.fixedMargin != null ? dec(input.fixedMargin) : null,
    percentMarkup: input.percentMarkup ?? null,
    minProfit: input.minProfit != null ? dec(input.minProfit) : null,
    roundingRule: input.roundingRule,
    compareAtPrice: input.compareAtPrice != null ? dec(input.compareAtPrice) : null,
    taxRatePercent: input.taxRatePercent,
    weightGrams: input.weightGrams ?? null,
    seoTitle: input.seoTitle || null,
    seoDescription: input.seoDescription || null,
    hasVariants: input.variants.length > 0,
  };

  // Price the product through the engine (product-level rule resolution).
  const { breakdown, rule } = await resolvePricing({
    ...productData,
    supplierId: productData.supplierId,
    categoryId: productData.categoryId,
    id: input.id,
  });

  let product;
  if (input.id) {
    const existing = await prisma.product.findUnique({ where: { id: input.id } });
    if (!existing) throw notFound('Product not found');
    product = await prisma.product.update({
      where: { id: input.id },
      data: { ...productData, sellingPrice: dec(breakdown.sellingPricePaise) },
    });
  } else {
    if (input.sku) {
      const skuTaken = await prisma.product.findUnique({ where: { sku: input.sku } });
      if (skuTaken) throw conflict(`SKU "${input.sku}" is already used by another product`);
    }
    product = await prisma.product.create({
      data: { ...productData, sellingPrice: dec(breakdown.sellingPricePaise) },
    });
  }

  // --- Images: replace collection -------------------------------------------
  await prisma.productImage.deleteMany({ where: { productId: product.id } });
  if (input.images.length > 0) {
    await prisma.productImage.createMany({
      data: input.images.map((img, idx) => ({
        productId: product.id,
        url: img.url,
        alt: img.alt || null,
        videoUrl: img.videoUrl || null,
        position: img.position ?? idx,
        isPrimary: img.isPrimary || idx === 0,
      })),
    });
  }

  // --- Variants: sync collection ---------------------------------------------
  const existingVariants = await prisma.productVariant.findMany({
    where: { productId: product.id },
  });
  const keepIds = input.variants.map((v) => v.id).filter((id): id is string => Boolean(id));
  await prisma.productVariant.deleteMany({
    where: { productId: product.id, id: { notIn: keepIds.length > 0 ? keepIds : ['__none__'] } },
  });
  for (const [idx, v] of input.variants.entries()) {
    const variantData = {
      productId: product.id,
      name: v.name,
      sku: v.sku || null,
      size: v.size || null,
      color: v.color || null,
      supplierCost: v.supplierCost != null ? dec(v.supplierCost) : null,
      supplierShippingCost: null,
      sellingPrice: v.sellingPrice != null ? dec(v.sellingPrice) : null,
      compareAtPrice: v.compareAtPrice != null ? dec(v.compareAtPrice) : null,
      taxRatePercent: v.taxRatePercent ?? null,
      stock: v.stock ?? 0,
      isActive: v.isActive ?? true,
      sortOrder: v.sortOrder ?? idx,
    };
    if (v.id && existingVariants.some((ev) => ev.id === v.id)) {
      await prisma.productVariant.update({ where: { id: v.id }, data: variantData });
    } else {
      await prisma.productVariant.create({ data: variantData });
    }
  }

  // Keep the SupplierProduct mapping cost in sync when a supplier SKU is set.
  if (product.supplierId && product.supplierSku) {
    await prisma.supplierProduct.upsert({
      where: {
        supplierId_supplierSku: {
          supplierId: product.supplierId,
          supplierSku: product.supplierSku,
        },
      },
      create: {
        supplierId: product.supplierId,
        productId: product.id,
        supplierSku: product.supplierSku,
        supplierCost: dec(input.supplierCost),
        supplierShippingCost: dec(input.supplierShippingCost ?? 0),
      },
      update: {
        productId: product.id,
        supplierCost: dec(input.supplierCost),
        supplierShippingCost: dec(input.supplierShippingCost ?? 0),
      },
    });
  }

  await auditLog({
    actor,
    action: input.id ? 'product.updated' : 'product.created',
    entityType: 'Product',
    entityId: product.id,
    data: {
      slug,
      sellingPricePaise: breakdown.sellingPricePaise,
      ruleId: rule?.id ?? null,
      warnings: breakdown.warnings,
    },
  });

  return { id: product.id, slug: product.slug, sellingPricePaise: breakdown.sellingPricePaise };
}

/**
 * Re-runs the pricing engine for ONE product and applies the result. Used
 * after supplier-product mapping syncs a new cost onto the product, so the
 * selling price can never silently drift away from the configured margin
 * strategy. Admin fixed-price overrides are preserved BY CONSTRUCTION (the
 * engine returns the fixed price unchanged); the configured minimum margin is
 * never reduced. Returns a full explanation for UI display + audit.
 */
export async function applyEnginePricingToProduct(productId: string): Promise<{
  oldPricePaise: number;
  newPricePaise: number;
  applied: boolean;
  minSafePricePaise: number;
  maxSafeDiscountPaise: number;
  marginPercent: number;
  estimatedNetProfitPaise: number;
  ruleName: string | null;
  ruleScope: string | null;
  warnings: string[];
}> {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw notFound('Product not found');
  const oldPricePaise = Math.round(Number(product.sellingPrice) * 100);
  const { breakdown, rule } = await resolvePricing(product);
  const applied = breakdown.sellingPricePaise !== oldPricePaise;
  if (applied) {
    await prisma.product.update({
      where: { id: productId },
      data: { sellingPrice: (breakdown.sellingPricePaise / 100).toFixed(2) },
    });
  }
  const settings = await getSettings();
  const floorPaise = minSafePricePaise(breakdown.totalCostPaise, settings);
  return {
    oldPricePaise,
    newPricePaise: breakdown.sellingPricePaise,
    applied,
    minSafePricePaise: floorPaise,
    maxSafeDiscountPaise: Math.max(0, breakdown.sellingPricePaise - floorPaise),
    marginPercent: breakdown.effectiveMarginPercent,
    estimatedNetProfitPaise: breakdown.estimatedNetProfitPaise,
    ruleName: rule?.name ?? null,
    ruleScope: rule?.scope ?? null,
    warnings: breakdown.warnings,
  };
}

export async function archiveProduct(productId: string, actor: Actor): Promise<void> {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw notFound('Product not found');
  await prisma.product.update({ where: { id: productId }, data: { status: 'ARCHIVED' } });
  await auditLog({ actor, action: 'product.archived', entityType: 'Product', entityId: productId });
}

export async function deleteProduct(productId: string, actor: Actor): Promise<void> {
  // Hard delete is refused when orders reference the product (history must be
  // preserved); archive instead. Order items keep their snapshots.
  const orderItemCount = await prisma.orderItem.count({ where: { productId } });
  if (orderItemCount > 0) {
    throw conflict(
      'This product has order history and cannot be deleted. Archive it instead - historical orders keep their snapshots.'
    );
  }
  await prisma.product.delete({ where: { id: productId } });
  await auditLog({ actor, action: 'product.deleted', entityType: 'Product', entityId: productId });
}

// ---------------------------------------------------------------------------
// Bulk repricing (pricing-rule management)
// ---------------------------------------------------------------------------

export interface RepriceRow {
  productId: string;
  name: string;
  currentPricePaise: number;
  newPricePaise: number;
  estimatedNetProfitPaise: number;
  ruleName: string | null;
  warnings: string[];
}

export async function repriceProducts(params: {
  scope: 'ALL' | 'CATEGORY' | 'SUPPLIER';
  categoryId?: string | null;
  supplierId?: string | null;
  apply: boolean;
  actor: Actor;
}): Promise<{ rows: RepriceRow[]; applied: number }> {
  const where = {
    status: { not: 'ARCHIVED' as const },
    ...(params.scope === 'CATEGORY' && params.categoryId ? { categoryId: params.categoryId } : {}),
    ...(params.scope === 'SUPPLIER' && params.supplierId ? { supplierId: params.supplierId } : {}),
  };
  const products = await prisma.product.findMany({ where, take: 500 });
  const rows: RepriceRow[] = [];
  let applied = 0;

  for (const product of products) {
    const { breakdown, rule } = await resolvePricing(product);
    rows.push({
      productId: product.id,
      name: product.name,
      currentPricePaise: Math.round(Number(product.sellingPrice) * 100),
      newPricePaise: breakdown.sellingPricePaise,
      estimatedNetProfitPaise: breakdown.estimatedNetProfitPaise,
      ruleName: rule?.name ?? null,
      warnings: breakdown.warnings,
    });
    if (
      params.apply &&
      breakdown.sellingPricePaise !== Math.round(Number(product.sellingPrice) * 100)
    ) {
      await prisma.product.update({
        where: { id: product.id },
        data: { sellingPrice: dec(breakdown.sellingPricePaise) },
      });
      applied += 1;
    }
  }

  if (params.apply) {
    await auditLog({
      actor: params.actor,
      action: 'products.repriced',
      data: { scope: params.scope, applied, total: rows.length },
    });
  }
  return { rows, applied };
}

/** Lightweight guard used by admin mutations. */
export function assertValidProductInput(input: unknown): ProductInput {
  const parsed = productInputSchema.safeParse(input);
  if (!parsed.success) throw badRequest('Invalid product data', parsed.error.flatten());
  return parsed.data;
}
