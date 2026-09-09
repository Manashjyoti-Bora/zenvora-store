import { apiRoute, jsonOk, badRequest, notFound } from '@/lib/errors';
import { couponBaseSchema } from '@/lib/validation/schemas';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { auditLog } from '@/lib/audit';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ code: string }> };

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { code } = await ctx.params;
    const existing = await prisma.coupon.findUnique({ where: { code: code.toUpperCase() } });
    if (!existing) throw notFound('Coupon not found');

    const raw = await readJson(req);
    if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
    const body = couponBaseSchema.partial().parse(raw);

    const coupon = await prisma.coupon.update({
      where: { code: existing.code },
      data: {
        description:
          body.description !== undefined ? body.description || null : existing.description,
        type: body.type ?? existing.type,
        value: body.value != null ? body.value.toFixed(2) : existing.value,
        scope: body.scope ?? existing.scope,
        categoryId: body.categoryId !== undefined ? body.categoryId : existing.categoryId,
        minOrderAmount:
          body.minOrderAmount !== undefined
            ? body.minOrderAmount != null
              ? body.minOrderAmount.toFixed(2)
              : null
            : existing.minOrderAmount,
        maxDiscountAmount:
          body.maxDiscountAmount !== undefined
            ? body.maxDiscountAmount != null
              ? body.maxDiscountAmount.toFixed(2)
              : null
            : existing.maxDiscountAmount,
        usageLimit: body.usageLimit !== undefined ? body.usageLimit : existing.usageLimit,
        perUserLimit: body.perUserLimit ?? existing.perUserLimit,
        startsAt:
          body.startsAt !== undefined
            ? body.startsAt
              ? new Date(body.startsAt)
              : null
            : existing.startsAt,
        endsAt:
          body.endsAt !== undefined
            ? body.endsAt
              ? new Date(body.endsAt)
              : null
            : existing.endsAt,
        isActive: body.isActive ?? existing.isActive,
        bypassMarginProtection: body.bypassMarginProtection ?? existing.bypassMarginProtection,
        firstOrderOnly: body.firstOrderOnly ?? existing.firstOrderOnly,
      },
    });
    await auditLog({
      actor: { id: admin.id, email: admin.email },
      action: 'coupon.updated',
      entityType: 'Coupon',
      entityId: coupon.code,
      req,
    });
    return jsonOk({ coupon });
  })(req, ctx);
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { code } = await ctx.params;
    const existing = await prisma.coupon.findUnique({ where: { code: code.toUpperCase() } });
    if (!existing) throw notFound('Coupon not found');
    // Keep history: deactivate instead of deleting when it was used.
    if (existing.usageCount > 0) {
      await prisma.coupon.update({ where: { code: existing.code }, data: { isActive: false } });
      await auditLog({
        actor: { id: admin.id, email: admin.email },
        action: 'coupon.deactivated',
        entityType: 'Coupon',
        entityId: existing.code,
        req,
      });
      return jsonOk({ deactivated: true });
    }
    await prisma.coupon.delete({ where: { code: existing.code } });
    await auditLog({
      actor: { id: admin.id, email: admin.email },
      action: 'coupon.deleted',
      entityType: 'Coupon',
      entityId: existing.code,
      req,
    });
    return jsonOk({ deleted: true });
  })(req, ctx);
}
