import { z } from 'zod';
import { apiRoute, jsonOk } from '@/lib/errors';
import { readJson } from '@/lib/http';
import { requireAdmin } from '@/lib/auth/guards';
import { recordManualSupplierCancellation } from '@/lib/orders/fulfilment';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };
const bodySchema = z.object({ note: z.string().trim().min(5).max(500) });

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = bodySchema.parse(await readJson(req));
    await recordManualSupplierCancellation({
      supplierOrderId: id,
      actorId: admin.id,
      actorEmail: admin.email,
      note: body.note,
      req,
    });
    return jsonOk({ recorded: true, supplierContacted: false });
  })(req, ctx);
}
