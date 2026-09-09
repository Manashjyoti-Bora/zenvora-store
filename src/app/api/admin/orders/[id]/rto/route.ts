import { apiRoute, jsonOk, badRequest, conflict } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { auditLog } from '@/lib/audit';
import { readJson } from '@/lib/http';
import { transitionOrder, canTransition } from '@/lib/orders/state';
import { restockOrderItems } from '@/lib/orders/inventory';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const rtoSchema = z.object({ stage: z.enum(['RTO', 'RTO_RECEIVED']) });

/**
 * Record a return-to-origin event (courier could not deliver).
 * RTO: parcel is coming back. RTO_RECEIVED: parcel is back with the owner -
 * LOCAL-mode lines are restocked with full movement history.
 */
export const POST = apiRoute(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin();
  const { id } = await ctx.params;
  const raw = await readJson(req);
  const body = rtoSchema.parse(raw ?? {});

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw badRequest('Order not found');
  if (!canTransition(order.status, body.stage)) {
    throw conflict(`Cannot mark this order ${body.stage} from status ${order.status}.`);
  }

  await transitionOrder({
    orderId: order.id,
    to: body.stage,
    actorType: 'ADMIN',
    actorId: admin.id,
    message: body.stage === 'RTO' ? 'Marked as return-to-origin (undeliverable)' : 'RTO parcel received back',
  });

  let restocked = 0;
  if (body.stage === 'RTO_RECEIVED') {
    restocked = await restockOrderItems({
      orderId: order.id,
      reason: 'RTO_RESTOCK',
      actorId: admin.id,
    });
  }

  await auditLog({
    actor: { id: admin.id, email: admin.email },
    action: `order.rto.${body.stage.toLowerCase()}`,
    entityType: 'Order',
    entityId: order.id,
    data: { restocked },
    req,
  });
  return jsonOk({ ok: true, stage: body.stage, restocked });
});
