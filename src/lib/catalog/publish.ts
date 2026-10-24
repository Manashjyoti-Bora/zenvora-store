import { prisma } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import { auditLog } from '../audit';
import { productInputSchema } from '../validation/schemas';
import { findApplicablePricingRule } from '../pricing/resolve';
import { saveProduct } from './products';
import { revalidateCatalog } from './revalidate';
import { extractSupplierProductMetadata } from './auto-import';
import type { Actor } from './types';
import type { SupplierProduct } from '@prisma/client';

/**
 * Supplier-product publication.
 *
 * Before this existed, a synced `SupplierProduct` could only be *mapped* to a
 * product an admin had already created by hand — the sync screen was a dead
 * end. This service turns a synced supplier entry into a real catalog product
 * through the SAME validated write path as the admin form (`productInputSchema`
 * → `saveProduct` → pricing engine), so a published product can never skip the
 * cost/price guards.
 *
 * Safety rules:
 *   - Requires a supplier cost above zero (a zero cost prices the product at ₹0).
 *   - Defaults to DRAFT. Publishing straight to ACTIVE additionally requires an
 *     admin-supplied name AND description — we never invent marketing copy.
 *   - Refuses to touch a supplier entry that is already mapped (protects the
 *     live price of the product it is mapped to).
 *   - Imports no images and makes no claims: the admin reviews before selling.
 */

export interface PublishSupplierProductInput {
  supplierProductId: string;
  actor: Actor;
  /** ACTIVE requires `name` + `description` overrides. Defaults to DRAFT. */
  status?: 'DRAFT' | 'ACTIVE';
  name?: string;
  description?: string;
  shortDescription?: string;
  categoryId?: string | null;
  /** Markup to use when no pricing rule applies to the new product. */
  percentMarkup?: number | null;
}

export interface PublishSupplierProductResult {
  productId: string;
  slug: string;
  status: 'DRAFT' | 'ACTIVE';
  sellingPricePaise: number;
  warnings: string[];
}

/**
 * Image URLs recorded for the supplier entry (discovery metadata / raw payload).
 * `extractSupplierProductMetadata` already validates and de-duplicates them;
 * we only cap the count. Never invented.
 */
function supplierImages(sp: Pick<SupplierProduct, 'supplierSku' | 'externalId' | 'raw'>): string[] {
  return extractSupplierProductMetadata(sp).images.slice(0, 8);
}

/** Best-effort human name from the stored supplier payload; never fabricated. */
function supplierProductName(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  for (const key of ['productName', 'name', 'productNameEn', 'title']) {
    const v = r[key];
    if (typeof v === 'string' && v.trim().length >= 2) return v.trim().slice(0, 200);
  }
  return null;
}

export async function publishSupplierProduct(
  input: PublishSupplierProductInput
): Promise<PublishSupplierProductResult> {
  const sp = await prisma.supplierProduct.findUnique({
    where: { id: input.supplierProductId },
    include: { supplier: { select: { id: true, name: true, type: true } } },
  });
  if (!sp) throw notFound('Supplier product not found');
  if (!sp.isActive) throw badRequest('This supplier entry is inactive — re-sync it first.');
  if (sp.productId) {
    throw conflict(
      'This supplier entry is already mapped to a catalog product. Unmap it first if you want to publish a new one.'
    );
  }

  const costPaise = Math.round(Number(sp.supplierCost) * 100);
  if (!(costPaise > 0)) {
    throw badRequest(
      'This supplier entry has no usable cost (zero or unknown), so publishing it would create a ₹0.00 product. Re-sync the supplier catalog or set the cost first.'
    );
  }

  const status = input.status ?? 'DRAFT';
  const inferredName = input.name?.trim() || supplierProductName(sp.raw) || null;

  if (status === 'ACTIVE') {
    // Publishing live requires human-authored copy: no invented description.
    if (!input.name?.trim() || !input.description?.trim()) {
      throw badRequest(
        'Publishing directly to ACTIVE needs an explicit product name and description — we never generate marketing copy for you. Save it as a draft instead.'
      );
    }
    if (input.description.trim().length < 10) {
      throw badRequest('The product description must be at least 10 characters.');
    }
  }

  const name = inferredName ?? `Supplier item ${sp.supplierSku}`;
  const description =
    input.description?.trim() ||
    [
      `Supplier catalog item ${sp.supplierSku} from ${sp.supplier.name}.`,
      'This description has not been reviewed yet — replace it with the real product details before publishing.',
    ].join(' ');

  // Resolve the pricing strategy the engine will actually use (an explicit
  // markup from the admin wins; otherwise the store's matching pricing rule
  // decides) so the validated input mirrors reality instead of requiring a
  // redundant product-level markup. Refuse — with an actionable message —
  // when nothing can price the product.
  const rule = await findApplicablePricingRule({
    supplierId: sp.supplierId,
    categoryId: input.categoryId ?? null,
  });
  const mode = rule?.mode ?? 'PERCENT_MARKUP';
  const percentMarkup =
    input.percentMarkup ??
    (mode === 'PERCENT_MARKUP' && rule?.percentMarkup != null ? Number(rule.percentMarkup) : null);
  const fixedMarginPaise =
    mode === 'FIXED_MARGIN' && rule?.fixedMargin != null ? Number(rule.fixedMargin) : null;

  if (mode === 'PERCENT_MARKUP' && percentMarkup == null) {
    throw badRequest(
      'No pricing rule applies to this product, so a markup percentage is required. Enter one, or configure a global/supplier pricing rule.'
    );
  }
  if (mode === 'FIXED_MARGIN' && fixedMarginPaise == null) {
    throw badRequest(
      'The pricing rule for this product has no fixed margin configured, so the selling price cannot be derived. Fix the rule or provide a markup percentage.'
    );
  }
  if (mode === 'FIXED_PRICE') {
    throw badRequest(
      'A FIXED_PRICE pricing rule cannot price a brand-new product. Create it as a draft and set the fixed price on the product form instead.'
    );
  }

  const candidate = {
    name,
    description,
    shortDescription: input.shortDescription ?? '',
    slug: '',
    sku: '',
    brand: '',
    status,
    categoryId: input.categoryId ?? null,
    supplierId: sp.supplierId,
    supplierSku: sp.supplierSku,
    stockMode: 'SUPPLIER_SYNC' as const,
    // NOTE: the input schema's money fields are expressed in RUPEES and
    // converted to integer paise by the schema itself — pass the stored ₹
    // decimal, not paise.
    supplierCost: Number(sp.supplierCost),
    supplierShippingCost: Number(sp.supplierShippingCost ?? 0),
    otherCost: 0,
    pricingMode: mode,
    fixedPrice: null,
    fixedMargin: fixedMarginPaise,
    percentMarkup,
    minProfit: null,
    roundingRule: rule?.roundingRule ?? ('ROUND_UP_10' as const),
    compareAtPrice: null,
    taxRatePercent: 0,
    // Carry the supplier's own media across (validated URLs only, primary
    // first) — publishing straight to ACTIVE requires at least one image.
    images: supplierImages(sp).map((url, idx) => ({
      url,
      alt: name.slice(0, 180),
      position: idx,
      isPrimary: idx === 0,
    })),
    variants: [],
  };

  const parsed = productInputSchema.safeParse(candidate);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
      .join('; ');
    // The most common cause is a missing markup (PERCENT_MARKUP with no rule and
    // no explicit percent), which is an admin-actionable configuration problem.
    throw badRequest(`Cannot publish this supplier product — ${details}`);
  }

  let result: { id: string; slug: string; sellingPricePaise: number };
  try {
    result = await saveProduct(parsed.data, input.actor);
  } catch (err) {
    // No applicable pricing rule + no markup → the engine refuses to guess a
    // price. Surface it as an actionable configuration error, not a 500.
    const message = err instanceof Error ? err.message : String(err);
    if (/percentMarkup/i.test(message)) {
      throw badRequest(
        'No pricing rule applies to this product, so a markup percentage is required. Set one on this form or configure a global/supplier pricing rule.'
      );
    }
    throw err;
  }

  await prisma.supplierProduct.update({
    where: { id: sp.id },
    data: { productId: result.id },
  });

  await auditLog({
    actor: input.actor,
    action: 'supplier_product.published',
    entityType: 'Product',
    entityId: result.id,
    data: {
      supplierProductId: sp.id,
      supplierId: sp.supplierId,
      supplierSku: sp.supplierSku,
      status,
      sellingPricePaise: result.sellingPricePaise,
    },
  });

  revalidateCatalog({ productSlugs: [result.slug] });

  const warnings: string[] = [];
  if (status === 'DRAFT') {
    warnings.push(
      'Saved as a draft. Add images, a real description and review the price, then set it to ACTIVE.'
    );
  }
  return {
    productId: result.id,
    slug: result.slug,
    status,
    sellingPricePaise: result.sellingPricePaise,
    warnings,
  };
}
