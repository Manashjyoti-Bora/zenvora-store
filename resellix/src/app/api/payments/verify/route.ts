import { apiRoute, jsonOk, badRequest, notFound, conflict } from '@/lib/errors';
import { verifyPaymentSchema } from '@/lib/validation/schemas';
import { findOrderForAccess } from '@/lib/orders/access';
import { getCurrentUser } from '@/lib/auth/guards';
import { getPaymentProvider } from '@/lib/payments';
import { confirmPaymentResult } from '@/lib/payments/confirm';
import { prisma } from '@/lib/db';
import { toPaise } from '@/lib/money';
import { kickJobRunner } from '@/lib/jobs/queue';
import { assertRateLimit } from '@/lib/rate-limit';
import { clientIp, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Server-side payment verification after the browser checkout returns.
 *
 * The browser result is NEVER trusted: this route re-verifies with the
 * provider (gateway fetch and/or HMAC signature) before anything is
 * confirmed. The Razorpay webhook performs the same confirmation
 * independently; the pipeline is idempotent, so whichever arrives first wins
 * and the second is a recorded no-op.
 */
export const POST = apiRoute(async (req: Request) => {
  const ip = clientIp(req) ?? 'local';
  assertRateLimit(`pay-verify:${ip}`, { limit: 30, windowMs: 10 * 60_000 });

  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = verifyPaymentSchema.parse(raw);

  const user = await getCurrentUser();
  const order = await findOrderForAccess(body.orderNumber, user, body.email ?? null);

  const payment = await prisma.payment.findUnique({
    where: { providerOrderId: body.providerOrderId },
  });
  if (!payment || payment.orderId !== order.id) {
    throw notFound('No matching payment attempt found for this order.');
  }
  if (payment.status === 'PAID') {
    return jsonOk({ status: 'PAID', redirect: `/order/${order.orderNumber}/confirmation` });
  }

  const provider = getPaymentProvider();
  if (!provider || provider.kind !== payment.provider) {
    throw conflict(
      payment.provider === 'TEST'
        ? 'This is a TEST-mode payment; use the test simulator to complete it.'
        : 'The configured payment provider does not match this payment attempt.'
    );
  }

  const verification = await provider.verifyPayment({
    providerOrderId: body.providerOrderId,
    providerPaymentId: body.providerPaymentId ?? payment.providerPaymentId ?? undefined,
    signature: body.signature,
    expectedAmountPaise: toPaise(order.grandTotal),
  });

  if (verification.outcome === 'PAID') {
    const gatewayAmount =
      typeof verification.raw?.amount === 'number' ? (verification.raw.amount as number) : null;
    const confirm = await confirmPaymentResult({
      orderId: order.id,
      provider: payment.provider,
      providerOrderId: body.providerOrderId,
      providerPaymentId: verification.providerPaymentId ?? body.providerPaymentId,
      outcome: 'PAID',
      amountPaise: gatewayAmount,
      method: verification.method ?? null,
      feePaise: verification.feePaise ?? null,
      verifiedVia: verification.verifiedVia,
      raw: verification.raw ?? null,
      actorType: 'PAYMENT_PROVIDER',
    });
    kickJobRunner();
    if (confirm.outcome === 'REJECTED_AMOUNT_MISMATCH') {
      throw conflict('Payment amount does not match the order total. Support has been notified.');
    }
    return jsonOk({ status: 'PAID', redirect: `/order/${order.orderNumber}/confirmation` });
  }

  if (verification.outcome === 'FAILED') {
    await confirmPaymentResult({
      orderId: order.id,
      provider: payment.provider,
      providerOrderId: body.providerOrderId,
      providerPaymentId: verification.providerPaymentId ?? body.providerPaymentId,
      outcome: 'FAILED',
      failureReason: verification.failureReason ?? 'Payment failed or was cancelled',
      actorType: 'PAYMENT_PROVIDER',
    });
    return jsonOk({
      status: 'FAILED',
      reason: verification.failureReason ?? 'Payment failed or was cancelled',
      redirect: `/checkout/payment/${order.orderNumber}`,
    });
  }

  return jsonOk({
    status: 'PENDING',
    redirect: `/order/${order.orderNumber}/confirmation`,
  });
});
