import { z } from 'zod';
import { apiRoute, jsonOk, badRequest } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { resolvePricing } from '@/lib/pricing/resolve';
import { readJson } from '@/lib/http';
import { assertRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const previewSchema = z.object({
  productId: z.string().min(1).optional().nullable(),
  supplierCost: z.coerce.number().min(0).max(10_000_000).default(0),
  supplierShippingCost: z.coerce.number().min(0).max(10_000_000).default(0),
  otherCost: z.coerce.number().min(0).max(10_000_000).default(0),
  pricingMode: z.enum(['FIXED_PRICE', 'FIXED_MARGIN', 'PERCENT_MARKUP']).default('PERCENT_MARKUP'),
  fixedPrice: z.coerce.number().min(0).max(10_000_000).nullable().optional(),
  fixedMargin: z.coerce.number().min(0).max(10_000_000).nullable().optional(),
  percentMarkup: z.coerce.number().min(0).max(1000).nullable().optional(),
  minProfit: z.coerce.number().min(0).max(10_000_000).nullable().optional(),
  roundingRule: z.enum(['NONE', 'ROUND_UP_10', 'NEAREST_9', 'NEAREST_99']).default('ROUND_UP_10'),
  taxRatePercent: z.coerce.number().min(0).max(40).default(0),
  categoryId: z.string().min(1).optional().nullable(),
  supplierId: z.string().min(1).optional().nullable(),
});

/**
 * Live pricing-engine preview for the product form. Read-only: nothing is
 * stored. Uses the same resolvePricing() pipeline (including applicable
 * pricing rules) that saveProduct() will apply, so what the admin sees is
 * what the engine will compute.
 */
export const POST = apiRoute(async (req: Request) => {
  const admin = await requireAdmin();
  assertRateLimit(`pricing-preview:${admin.id}`, { limit: 120, windowMs: 5 * 60_000 });

  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = previewSchema.parse(raw);

  const { breakdown, rule } = await resolvePricing({
    id: body.productId ?? undefined,
    supplierCost: body.supplierCost,
    supplierShippingCost: body.supplierShippingCost,
    otherCost: body.otherCost,
    pricingMode: body.pricingMode,
    fixedPrice: body.fixedPrice ?? null,
    fixedMargin: body.fixedMargin ?? null,
    percentMarkup: body.percentMarkup ?? null,
    minProfit: body.minProfit ?? null,
    roundingRule: body.roundingRule,
    taxRatePercent: body.taxRatePercent,
    categoryId: body.categoryId ?? null,
    supplierId: body.supplierId ?? null,
  });

  return jsonOk({
    breakdown,
    appliedRule: rule
      ? { id: rule.id, name: rule.name, scope: rule.scope, priority: rule.priority }
      : null,
  });
});
