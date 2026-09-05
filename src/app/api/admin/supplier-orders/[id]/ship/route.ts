import { apiRoute, jsonOk, badRequest, notFound } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { markSupplierOrderShipped } from '@/lib/orders/fulfilment';
import { auditLog } from '@/lib/audit';
import { z } from 'zod';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const shipSchema = z.object({
  carrier: z.string().trim().max(120).optional().or(z.literal('')).nullable(),
  trackingNumber: z.string().trim().max(120).optional().or(z.literal('')).nullable(),
  trackingUrl: z.string().trim().max(500).url().optional().or(z.literal('')).nullable(),
});

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const so = await prisma.supplierOrder.findUnique({ where: { id } });
    if (!so) throw notFound('Supplier order not found');

    const raw = await readJson(req);
    if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
    const body = shipSchema.parse(raw);
    if (!body.carrier && !body.trackingNumber) {
      throw badRequest('Provide at least a carrier or a tracking number');
    }

    await markSupplierOrderShipped({
      supplierOrderId: id,
      carrier: body.carrier || null,
      trackingNumber: body.trackingNumber || null,
      trackingUrl: body.trackingUrl || null,
      adminId: admin.id,
    });
    await auditLog({
      actor: { id: admin.id, email: admin.email },
      action: 'supplier_order.shipped',
      entityType: 'SupplierOrder',
      entityId: id,
      data: { carrier: body.carrier, trackingNumber: body.trackingNumber },
      req,
    });
    return jsonOk({ shipped: true });
  })(req, ctx);
}
