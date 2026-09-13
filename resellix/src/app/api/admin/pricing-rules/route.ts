import { apiRoute, jsonOk, badRequest } from '@/lib/errors';
import { pricingRuleInputSchema } from '@/lib/validation/schemas';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { auditLog } from '@/lib/audit';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(async (req: Request) => {
  const admin = await requireAdmin();
  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = pricingRuleInputSchema.parse(raw);

  if (body.scope === 'SUPPLIER' && !body.supplierId)
    throw badRequest('Select a supplier for this rule');
  if (body.scope === 'CATEGORY' && !body.categoryId)
    throw badRequest('Select a category for this rule');
  if (body.scope === 'PRODUCT' && !body.productId)
    throw badRequest('Select a product for this rule');
  if (body.mode === 'FIXED_MARGIN' && body.fixedMargin == null)
    throw badRequest('Fixed margin is required');
  if (body.mode === 'PERCENT_MARKUP' && body.percentMarkup == null)
    throw badRequest('Markup percent is required');

  const rule = await prisma.pricingRule.create({
    data: {
      name: body.name,
      scope: body.scope,
      supplierId: body.scope === 'SUPPLIER' ? body.supplierId : null,
      categoryId: body.scope === 'CATEGORY' ? body.categoryId : null,
      productId: body.scope === 'PRODUCT' ? body.productId : null,
      mode: body.mode,
      fixedMargin: body.fixedMargin != null ? (body.fixedMargin / 100).toFixed(2) : null,
      percentMarkup: body.percentMarkup ?? null,
      minProfit: body.minProfit != null ? (body.minProfit / 100).toFixed(2) : null,
      roundingRule: body.roundingRule,
      priority: body.priority ?? 0,
      isActive: body.isActive ?? true,
    },
  });
  await auditLog({
    actor: { id: admin.id, email: admin.email },
    action: 'pricing_rule.created',
    entityType: 'PricingRule',
    entityId: rule.id,
    data: { scope: rule.scope, mode: rule.mode },
    req,
  });
  return jsonOk({ rule }, { status: 201 });
});
