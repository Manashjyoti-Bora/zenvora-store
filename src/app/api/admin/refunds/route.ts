import { apiRoute, jsonOk, badRequest } from '@/lib/errors';
import { refundCreateSchema } from '@/lib/validation/schemas';
import { requireAdmin } from '@/lib/auth/guards';
import { createRefund } from '@/lib/payments/refunds';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(async (req: Request) => {
  const admin = await requireAdmin();
  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = refundCreateSchema.parse(raw);

  const result = await createRefund({
    orderId: body.orderId,
    amountPaise: Math.round(body.amount * 100),
    reason: body.reason,
    returnRequestId: body.returnRequestId ?? null,
    actor: 'ADMIN',
    actorId: admin.id,
  });
  return jsonOk(result, { status: 201 });
});
