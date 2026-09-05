import { apiRoute, jsonOk, badRequest } from '@/lib/errors';
import { returnDecisionSchema } from '@/lib/validation/schemas';
import { requireAdmin } from '@/lib/auth/guards';
import { decideReturn } from '@/lib/orders/returns';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const raw = await readJson(req);
    if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
    const body = returnDecisionSchema.parse(raw);

    const result = await decideReturn({
      returnId: id,
      decision: body.decision,
      adminNote: body.adminNote ?? null,
      refundAmountPaise: body.refundAmount != null ? Math.round(body.refundAmount * 100) : null,
      adminId: admin.id,
    });
    return jsonOk(result);
  })(req, ctx);
}
