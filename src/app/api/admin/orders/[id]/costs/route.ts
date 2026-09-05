import { apiRoute, jsonOk, badRequest, notFound } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { adjustOrderCosts } from '@/lib/orders/finance';
import { auditLog } from '@/lib/audit';
import { z } from 'zod';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const costSchema = z.object({
  shippingCost: z.coerce.number().min(0).max(1_000_000).optional().nullable(),
  otherCost: z.coerce.number().min(0).max(1_000_000).optional().nullable(),
});

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) throw notFound('Order not found');

    const raw = await readJson(req);
    if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
    const body = costSchema.parse(raw);

    const updated = await adjustOrderCosts(id, {
      ...(body.shippingCost != null
        ? { shippingCostPaise: Math.round(body.shippingCost * 100) }
        : {}),
      ...(body.otherCost != null ? { otherCostPaise: Math.round(body.otherCost * 100) } : {}),
    });
    await auditLog({
      actor: { id: admin.id, email: admin.email },
      action: 'order.costs_adjusted',
      entityType: 'Order',
      entityId: id,
      data: body as Record<string, unknown>,
      req,
    });
    return jsonOk({
      shippingCostTotal: updated.shippingCostTotal,
      otherCostTotal: updated.otherCostTotal,
      actualProfit: updated.actualProfit,
    });
  })(req, ctx);
}
