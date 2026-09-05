import { apiRoute, jsonOk, notFound } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { retrySupplierFulfilment } from '@/lib/orders/fulfilment';
import { auditLog } from '@/lib/audit';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const so = await prisma.supplierOrder.findUnique({ where: { id } });
    if (!so) throw notFound('Supplier order not found');

    await retrySupplierFulfilment(id, admin.id);
    await auditLog({
      actor: { id: admin.id, email: admin.email },
      action: 'supplier_order.retry',
      entityType: 'SupplierOrder',
      entityId: id,
      req,
    });
    return jsonOk({ retryQueued: true });
  })(req, ctx);
}
