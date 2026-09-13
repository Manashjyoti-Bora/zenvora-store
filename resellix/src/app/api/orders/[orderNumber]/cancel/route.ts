import { apiRoute, jsonOk, badRequest } from '@/lib/errors';
import { cancelOrderSchema } from '@/lib/validation/schemas';
import { findOrderForAccess } from '@/lib/orders/access';
import { getCurrentUser } from '@/lib/auth/guards';
import { cancelOrder } from '@/lib/orders/cancel';
import { kickJobRunner } from '@/lib/jobs/queue';
import { assertRateLimit } from '@/lib/rate-limit';
import { clientIp, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ orderNumber: string }> }
): Promise<Response> {
  return apiRoute(async () => {
    const { orderNumber } = await ctx.params;
    const ip = clientIp(req) ?? 'local';
    assertRateLimit(`cancel:${ip}`, { limit: 10, windowMs: 30 * 60_000 });

    const raw = await readJson(req);
    if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
    const body = cancelOrderSchema.parse(raw);

    const user = await getCurrentUser();
    const order = await findOrderForAccess(orderNumber, user, null);

    const result = await cancelOrder({
      orderId: order.id,
      actorType: user ? 'CUSTOMER' : 'CUSTOMER',
      actorId: user?.id ?? null,
      reason: body.reason,
    });
    kickJobRunner();
    return jsonOk(result);
  })(req, ctx);
}
