import { apiRoute, jsonOk, badRequest } from '@/lib/errors';
import { checkoutSchema } from '@/lib/validation/schemas';
import { getOrCreateCart } from '@/lib/cart/service';
import { createOrderFromCart } from '@/lib/orders/create';
import { confirmCodOrder } from '@/lib/payments/confirm';
import { getCurrentUser } from '@/lib/auth/guards';
import { assertRateLimit } from '@/lib/rate-limit';
import { clientIp, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(async (req: Request) => {
  const ip = clientIp(req) ?? 'local';
  assertRateLimit(`checkout:${ip}`, { limit: 10, windowMs: 10 * 60_000 });

  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = checkoutSchema.parse(raw);

  const user = await getCurrentUser();
  const cart = await getOrCreateCart(user?.id ?? null);

  const order = await createOrderFromCart({
    cartId: cart.id,
    user,
    guest: !user && body.guest ? body.guest : null,
    address: {
      fullName: body.address.fullName,
      phone: body.address.phone,
      line1: body.address.line1,
      line2: body.address.line2 ?? null,
      city: body.address.city,
      state: body.address.state,
      postalCode: body.address.postalCode,
      country: body.address.country,
    },
    paymentMethod: body.paymentMethod,
    couponCode: body.couponCode ?? null,
    customerNote: body.customerNote ?? null,
    idempotencyKey: body.idempotencyKey ?? null,
    req,
  });

  // COD orders are confirmed immediately (no gateway step).
  if (order.paymentMethod === 'COD' && !order.alreadyExisted) {
    await confirmCodOrder(order.orderId);
  }

  return jsonOk(
    {
      orderNumber: order.orderNumber,
      orderId: order.orderId,
      grandTotalPaise: order.grandTotalPaise,
      paymentMethod: order.paymentMethod,
      status: order.status,
      nextStep:
        order.paymentMethod === 'COD'
          ? 'CONFIRMATION'
          : order.status === 'PENDING_PAYMENT' || order.status === 'PAYMENT_FAILED'
            ? 'PAYMENT'
            : 'CONFIRMATION',
    },
    { status: order.alreadyExisted ? 200 : 201 }
  );
});
