import { apiRoute, jsonOk, badRequest, notFound } from '@/lib/errors';
import { pricingRuleInputSchema } from '@/lib/validation/schemas';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { auditLog } from '@/lib/audit';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const existing = await prisma.pricingRule.findUnique({ where: { id } });
    if (!existing) throw notFound('Pricing rule not found');

    const raw = await readJson(req);
    if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
    const body = pricingRuleInputSchema.partial().parse(raw);

    const rule = await prisma.pricingRule.update({
      where: { id },
      data: {
        name: body.name ?? existing.name,
        scope: body.scope ?? existing.scope,
        supplierId: body.supplierId !== undefined ? body.supplierId : existing.supplierId,
        categoryId: body.categoryId !== undefined ? body.categoryId : existing.categoryId,
        productId: body.productId !== undefined ? body.productId : existing.productId,
        mode: body.mode ?? existing.mode,
        fixedMargin:
          body.fixedMargin !== undefined
            ? body.fixedMargin != null
              ? (body.fixedMargin / 100).toFixed(2)
              : null
            : existing.fixedMargin,
        percentMarkup:
          body.percentMarkup !== undefined ? body.percentMarkup : existing.percentMarkup,
        minProfit:
          body.minProfit !== undefined
            ? body.minProfit != null
              ? (body.minProfit / 100).toFixed(2)
              : null
            : existing.minProfit,
        roundingRule: body.roundingRule ?? existing.roundingRule,
        priority: body.priority ?? existing.priority,
        isActive: body.isActive ?? existing.isActive,
      },
    });
    await auditLog({
      actor: { id: admin.id, email: admin.email },
      action: 'pricing_rule.updated',
      entityType: 'PricingRule',
      entityId: id,
      req,
    });
    return jsonOk({ rule });
  })(req, ctx);
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    await prisma.pricingRule.deleteMany({ where: { id } });
    await auditLog({
      actor: { id: admin.id, email: admin.email },
      action: 'pricing_rule.deleted',
      entityType: 'PricingRule',
      entityId: id,
      req,
    });
    return jsonOk({ deleted: true });
  })(req, ctx);
}
