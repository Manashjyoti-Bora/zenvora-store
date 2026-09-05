import { apiRoute, jsonOk, badRequest, notFound } from '@/lib/errors';
import { adminOrderCancelSchema } from '@/lib/validation/schemas';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { cancelOrder } from '@/lib/orders/cancel';
import { kickJobRunner } from '@/lib/jobs/queue';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) throw notFound('Order not found');

    const raw = await readJson(req);
    if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
    const body = adminOrderCancelSchema.parse({ ...raw, orderId: id });

    const url = new URL(req.url);
    const force = url.searchParams.get('force') === '1';

    const result = await cancelOrder({
      orderId: id,
      actorType: 'ADMIN',
      actorId: admin.id,
      reason: body.reason,
      refund: body.refund,
      force,
    });
    kickJobRunner();
    return jsonOk(result);
  })(req, ctx);
}
