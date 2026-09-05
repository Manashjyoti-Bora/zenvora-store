import { apiRoute, jsonOk, badRequest, conflict, ApiError } from '@/lib/errors';
import { createPaymentSchema } from '@/lib/validation/schemas';
import { findOrderForAccess } from '@/lib/orders/access';
import { getCurrentUser } from '@/lib/auth/guards';
import { getPaymentProvider } from '@/lib/payments';
import { prisma } from '@/lib/db';
import { toPaise } from '@/lib/money';
import { getSettings } from '@/lib/settings';
import { assertRateLimit } from '@/lib/rate-limit';
import { clientIp, readJson } from '@/lib/http';
import { recordOrderEvent } from '@/lib/orders/state';

export const dynamic = 'force-dynamic';

/**
 * Creates a provider-side payment order for an existing store order.
 * The amount ALWAYS comes from the stored order total - never from the
 * client - so the payable amount cannot be manipulated.
 */
export const POST = apiRoute(async (req: Request) => {
  const ip = clientIp(req) ?? 'local';
  assertRateLimit(`pay-create:${ip}`, { limit: 30, windowMs: 10 * 60_000 });

  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = createPaymentSchema.parse(raw);

  const user = await getCurrentUser();
  const order = await findOrderForAccess(body.orderNumber, user, body.email ?? null);

  if (
    ['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(order.paymentStatus) ||
    ['CANCELLED', 'REFUNDED', 'DELIVERED', 'SHIPPED'].includes(order.status)
  ) {
    throw conflict(
      `This order does not need payment (status: ${order.status.replace(/_/g, ' ')}).`
    );
  }
  if (order.paymentMethod === 'COD') {
    throw conflict('This is a Cash-on-Delivery order; no online payment is required.');
  }
  if (!['PENDING_PAYMENT', 'PAYMENT_FAILED'].includes(order.status)) {
    throw conflict(`Payment is not possible in order status ${order.status.replace(/_/g, ' ')}.`);
  }

  const provider = getPaymentProvider();
  if (!provider) {
    throw new ApiError(
      503,
      'Online payments are not configured on this store yet. The owner must add payment gateway credentials (see SETUP_CHECKLIST.md) or choose Cash on Delivery if enabled.',
      'PAYMENTS_NOT_CONFIGURED'
    );
  }

  const settings = await getSettings();
  const amountPaise = toPaise(order.grandTotal);
  if (amountPaise <= 0) throw conflict('Order total must be greater than zero.');

  const result = await provider.createPaymentOrder({
    orderId: order.id,
    orderNumber: order.orderNumber,
    amountPaise,
    currency: order.currency,
    customer: {
      name: order.user?.name ?? order.guestName ?? undefined,
      email: order.user?.email ?? order.guestEmail ?? undefined,
      phone: order.user?.phone ?? order.guestPhone ?? undefined,
    },
  });

  await prisma.payment.upsert({
    where: { providerOrderId: result.providerOrderId },
    create: {
      orderId: order.id,
      provider: result.provider,
      providerOrderId: result.providerOrderId,
      amount: (amountPaise / 100).toFixed(2),
      currency: result.currency,
      status: 'CREATED',
    },
    update: {},
  });

  await recordOrderEvent({
    orderId: order.id,
    type: 'PAYMENT_INITIATED',
    message: `Payment order created via ${result.provider} (${result.providerOrderId})`,
    actorType: 'CUSTOMER',
    actorId: user?.id ?? null,
  });

  return jsonOk({
    mode: result.checkoutMode,
    provider: result.provider,
    providerOrderId: result.providerOrderId,
    amountPaise,
    currency: result.currency,
    orderNumber: order.orderNumber,
    keyId: result.keyId ?? null,
    storeName: settings.storeName,
    prefill: {
      name: order.user?.name ?? order.guestName ?? '',
      email: order.user?.email ?? order.guestEmail ?? '',
      contact: order.user?.phone ?? order.guestPhone ?? '',
    },
  });
});
