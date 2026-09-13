import { apiRoute, jsonOk, badRequest, notFound, ApiError } from '@/lib/errors';
import { testSimulatePaymentSchema } from '@/lib/validation/schemas';
import { isTestPaymentsAllowed } from '@/lib/env';
import { prisma } from '@/lib/db';
import { confirmPaymentResult } from '@/lib/payments/confirm';
import { findOrderForAccess } from '@/lib/orders/access';
import { getCurrentUser } from '@/lib/auth/guards';
import { kickJobRunner } from '@/lib/jobs/queue';
import { randomCode } from '@/lib/crypto';
import { readJson } from '@/lib/http';
import { recordOrderEvent } from '@/lib/orders/state';

export const dynamic = 'force-dynamic';

/**
 * TEST-mode payment simulator - exists ONLY when PAYMENTS_TEST_MODE=true and
 * NODE_ENV != production (double-gated by isTestPaymentsAllowed()). It runs
 * the exact same confirmation pipeline as a real gateway result, with every
 * record labelled TEST. In production this route responds 404.
 */
export const POST = apiRoute(async (req: Request) => {
  if (!isTestPaymentsAllowed()) throw notFound('Not available');

  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = testSimulatePaymentSchema.parse(raw);

  const user = await getCurrentUser();
  const order = await findOrderForAccess(body.orderNumber, user, body.email ?? null);

  const payment = await prisma.payment.findFirst({
    where: { orderId: order.id, provider: 'TEST' },
    orderBy: { createdAt: 'desc' },
  });
  if (!payment) {
    throw new ApiError(
      409,
      'No TEST payment attempt found. Start the payment from the checkout payment page first.',
      'NO_TEST_PAYMENT'
    );
  }

  if (body.outcome === 'success') {
    await confirmPaymentResult({
      orderId: order.id,
      provider: 'TEST',
      providerOrderId: payment.providerOrderId!,
      providerPaymentId: `pay_TEST_${randomCode(10)}`,
      outcome: 'PAID',
      method: 'test-upi',
      feePaise: null, // settings-based estimate will be recorded, flagged as estimate
      verifiedVia: 'TEST_SIMULATOR',
      raw: { test: true, simulated: 'success' },
      actorType: 'SYSTEM',
    });
  } else {
    await confirmPaymentResult({
      orderId: order.id,
      provider: 'TEST',
      providerOrderId: payment.providerOrderId!,
      providerPaymentId: `pay_TEST_${randomCode(10)}`,
      outcome: 'FAILED',
      failureReason: 'Simulated payment failure (TEST mode)',
      verifiedVia: 'TEST_SIMULATOR',
      raw: { test: true, simulated: 'failure' },
      actorType: 'SYSTEM',
    });
    await recordOrderEvent({
      orderId: order.id,
      type: 'TEST_PAYMENT_SIMULATED',
      message: 'Failure simulated via TEST provider',
    });
  }

  kickJobRunner();
  const refreshed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  return jsonOk({
    status: refreshed.paymentStatus,
    orderStatus: refreshed.status,
    redirect: `/order/${refreshed.orderNumber}/confirmation`,
    testMode: true,
  });
});
