import { apiRoute, jsonOk, notFound, conflict } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { markCodCollected } from '@/lib/payments/confirm';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) throw notFound('Order not found');
    if (order.paymentMethod !== 'COD') throw conflict('Order is not a COD order');
    if (order.status !== 'DELIVERED') {
      throw conflict('Mark COD collected only after the order is delivered (cash received).');
    }
    await markCodCollected(id, admin.id);
    return jsonOk({ collected: true });
  })(req, ctx);
}
