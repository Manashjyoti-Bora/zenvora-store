import { apiRoute, jsonOk, badRequest, notFound } from '@/lib/errors';
import { guestTrackSchema } from '@/lib/validation/schemas';
import { prisma } from '@/lib/db';
import { toPaise, formatINR } from '@/lib/money';
import { assertRateLimit } from '@/lib/rate-limit';
import { clientIp, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Guest order tracking: requires BOTH the order number and the email used at
 * checkout (never exposes an order by number alone - enumeration protection).
 */
export const POST = apiRoute(async (req: Request) => {
  const ip = clientIp(req) ?? 'local';
  assertRateLimit(`track:${ip}`, { limit: 20, windowMs: 15 * 60_000 });

  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = guestTrackSchema.parse(raw);

  const order = await prisma.order.findFirst({
    where: {
      orderNumber: body.orderNumber.trim().toUpperCase(),
      guestEmail: body.email,
    },
    include: {
      items: true,
      shipments: { include: { events: { orderBy: { eventAt: 'desc' } } } },
    },
  });
  // Uniform 404 whether the order exists or not (no enumeration).
  if (!order) {
    throw notFound(
      'No order found matching that order number and email combination. Please check both and try again.'
    );
  }

  return jsonOk({
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfilmentStatus: order.fulfilmentStatus,
    placedAt: order.placedAt ?? order.createdAt,
    total: formatINR(toPaise(order.grandTotal)),
    items: order.items.map((i) => {
      const snap = i.productSnapshot as Record<string, string | null>;
      return {
        name: snap?.name ?? 'Item',
        variant: snap?.variantName ?? null,
        quantity: i.quantity,
        lineTotal: formatINR(toPaise(i.lineTotal) - toPaise(i.lineDiscount)),
        image: snap?.image ?? null,
      };
    }),
    shipments: order.shipments.map((s) => ({
      carrier: s.carrier,
      trackingNumber: s.trackingNumber,
      trackingUrl: s.trackingUrl,
      status: s.status,
      shippedAt: s.shippedAt,
      deliveredAt: s.deliveredAt,
      events: s.events.map((e) => ({
        status: e.status,
        message: e.message,
        location: e.location,
        eventAt: e.eventAt,
      })),
    })),
  });
});
