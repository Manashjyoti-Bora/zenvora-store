import { apiRoute, jsonOk, badRequest } from '@/lib/errors';
import { returnRequestSchema } from '@/lib/validation/schemas';
import { findOrderForAccess } from '@/lib/orders/access';
import { getCurrentUser } from '@/lib/auth/guards';
import { requestReturn } from '@/lib/orders/returns';
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
    assertRateLimit(`return:${ip}`, { limit: 10, windowMs: 30 * 60_000 });

    const raw = await readJson(req);
    if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
    const body = returnRequestSchema.parse(raw);

    const user = await getCurrentUser();
    const order = await findOrderForAccess(orderNumber, user, null);

    const result = await requestReturn({
      orderId: order.id,
      orderItemId: body.orderItemId ?? null,
      reason: body.reason,
      note: body.note ?? null,
      actorType: 'CUSTOMER',
      actorId: user?.id ?? null,
    });
    return jsonOk(result, { status: 201 });
  })(req, ctx);
}
