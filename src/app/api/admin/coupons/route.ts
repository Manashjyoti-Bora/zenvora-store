import { apiRoute, jsonOk, badRequest, conflict } from '@/lib/errors';
import { couponInputSchema } from '@/lib/validation/schemas';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { auditLog } from '@/lib/audit';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(async (req: Request) => {
  const admin = await requireAdmin();
  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = couponInputSchema.parse(raw);

  const existing = await prisma.coupon.findUnique({ where: { code: body.code } });
  if (existing) throw conflict(`Coupon code "${body.code}" already exists`);
  if (body.startsAt && body.endsAt && new Date(body.startsAt) >= new Date(body.endsAt)) {
    throw badRequest('Coupon end date must be after the start date');
  }

  const coupon = await prisma.coupon.create({
    data: {
      code: body.code,
      description: body.description || null,
      type: body.type,
      value: body.type === 'PERCENT' ? body.value.toFixed(2) : body.value.toFixed(2),
      scope: body.scope,
      categoryId: body.scope === 'CATEGORY' ? body.categoryId : null,
      minOrderAmount: body.minOrderAmount != null ? body.minOrderAmount.toFixed(2) : null,
      maxDiscountAmount: body.maxDiscountAmount != null ? body.maxDiscountAmount.toFixed(2) : null,
      usageLimit: body.usageLimit ?? null,
      perUserLimit: body.perUserLimit ?? 1,
      startsAt: body.startsAt ? new Date(body.startsAt) : null,
      endsAt: body.endsAt ? new Date(body.endsAt) : null,
      isActive: body.isActive ?? true,
    },
  });
  await auditLog({
    actor: { id: admin.id, email: admin.email },
    action: 'coupon.created',
    entityType: 'Coupon',
    entityId: coupon.code,
    req,
  });
  return jsonOk({ coupon }, { status: 201 });
});
