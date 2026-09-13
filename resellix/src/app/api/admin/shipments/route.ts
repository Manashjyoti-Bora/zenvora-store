import { apiRoute, jsonOk, badRequest, notFound } from '@/lib/errors';
import { shipmentUpdateSchema } from '@/lib/validation/schemas';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { recordShipmentUpdate } from '@/lib/orders/fulfilment';
import { auditLog } from '@/lib/audit';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(async (req: Request) => {
  const admin = await requireAdmin();
  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = shipmentUpdateSchema.parse(raw);

  const order = await prisma.order.findUnique({ where: { id: body.orderId } });
  if (!order) throw notFound('Order not found');
  if (!body.trackingNumber && !body.carrier && !body.message) {
    throw badRequest('Provide a tracking number, carrier, or status message');
  }

  await recordShipmentUpdate({
    orderId: body.orderId,
    supplierOrderId: body.supplierOrderId ?? null,
    carrier: body.carrier ?? null,
    trackingNumber: body.trackingNumber ?? null,
    trackingUrl: body.trackingUrl ?? null,
    status: body.status,
    message: body.message ?? null,
    actorType: 'ADMIN',
    actorId: admin.id,
  });
  await auditLog({
    actor: { id: admin.id, email: admin.email },
    action: 'shipment.updated',
    entityType: 'Order',
    entityId: body.orderId,
    data: { status: body.status, trackingNumber: body.trackingNumber ?? null },
    req,
  });
  return jsonOk({ updated: true });
});
