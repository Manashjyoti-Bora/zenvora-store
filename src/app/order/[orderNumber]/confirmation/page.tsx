import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth/guards';
import { findOrderForAccess } from '@/lib/orders/access';
import { customerCanCancel } from '@/lib/orders/cancel';
import { getSettings } from '@/lib/settings';
import { prisma } from '@/lib/db';
import { OrderDetailView } from '@/components/orders/order-detail';
import { OrderActions } from '@/components/orders/order-actions';
import { CheckoutSteps } from '@/components/store/checkout-steps';
import { Alert } from '@/components/ui/feedback';
import { BoxIcon, ClockIcon } from '@/components/ui/icons';
import { LinkButton } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Order confirmation',
  robots: { index: false },
};

type Ctx = { params: Promise<{ orderNumber: string }> };

export default async function ConfirmationPage({
  params,
  searchParams,
}: Ctx & { searchParams: Promise<{ email?: string }> }) {
  const { orderNumber } = await params;
  const sp = await searchParams;
  const user = await getCurrentUser();

  let orderId: string;
  try {
    const accessible = await findOrderForAccess(orderNumber, user, sp.email ?? null);
    orderId = accessible.id;
  } catch {
    notFound();
  }

  const [order, settings] = await Promise.all([
    prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        shipments: { orderBy: { createdAt: 'desc' } },
        refunds: { orderBy: { createdAt: 'desc' } },
        returns: { orderBy: { createdAt: 'desc' } },
        user: { select: { email: true } },
      },
    }),
    getSettings(),
  ]);

  const guestEmail = !user && order.guestEmail ? order.guestEmail : null;
  const cancelCheck = await customerCanCancel(order.id);
  const deliveredAt = order.deliveredAt;
  const returnEligible =
    order.status === 'DELIVERED' &&
    settings.policies.returnWindowDays > 0 &&
    deliveredAt != null &&
    Date.now() - deliveredAt.getTime() <= settings.policies.returnWindowDays * 24 * 60 * 60 * 1000;

  const needsPayment =
    ['PENDING_PAYMENT', 'PAYMENT_FAILED'].includes(order.status) && order.paymentMethod !== 'COD';
  const paymentPending =
    order.paymentStatus === 'PENDING' && !needsPayment && order.paymentMethod !== 'COD';

  return (
    <div className="container-store py-6 sm:py-10">
      <div className="mx-auto max-w-3xl">
        <CheckoutSteps current="confirmation" />
        {/* Outcome header */}
        {needsPayment ? (
          <div className="card mb-6 p-6 text-center">
            <span
              className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-800 ring-1 ring-amber-300/60"
              aria-hidden="true"
            >
              <ClockIcon className="h-7 w-7" />
            </span>
            <h1 className="display mt-3">Your order is saved — payment pending</h1>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-400">
              Order <strong>{order.orderNumber}</strong> was created but payment is not complete
              yet. Finish the payment to confirm it; items stay reserved until then.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <LinkButton
                href={`/checkout/payment/${order.orderNumber}${guestEmail ? `?email=${encodeURIComponent(guestEmail)}` : ''}`}
                size="lg"
              >
                Complete payment
              </LinkButton>
              <LinkButton href="/contact" variant="outline" size="lg">
                Need help?
              </LinkButton>
            </div>
          </div>
        ) : paymentPending ? (
          <div className="mb-6">
            <Alert tone="info" title="Payment confirmation in progress">
              Your bank has accepted the payment; final confirmation usually arrives within minutes.
              We will email <strong>{order.user?.email ?? order.guestEmail}</strong> as soon as the
              order is confirmed. Please do not pay again.
            </Alert>
          </div>
        ) : (
          <div className="mb-6 text-center">
            {/* This branch renders ONLY after the order row was read from the
                database in a confirmed state (not pending / not awaiting
                payment), so the success mark never animates on an optimistic
                client guess. Transform/opacity + a single stroke draw; both are
                disabled under prefers-reduced-motion. */}
            <span
              className="motion-pop mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-sage-100 text-sage-600 ring-1 ring-sage-300/60"
              aria-hidden="true"
            >
              {order.paymentMethod === 'COD' ? (
                <BoxIcon className="h-7 w-7" />
              ) : (
                <svg
                  className="h-7 w-7"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path className="success-check" d="m4.5 12.5 5 5 10-11" />
                </svg>
              )}
            </span>
            <h1 className="mt-3">
              {order.paymentMethod === 'COD'
                ? 'Order placed successfully!'
                : 'Thank you — payment received!'}
            </h1>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-400">
              Order <strong>{order.orderNumber}</strong> is confirmed and being prepared. A
              confirmation email is on its way to{' '}
              <strong>{order.user?.email ?? order.guestEmail}</strong>.
              {order.paymentMethod === 'COD' && ' Please keep the exact amount ready for delivery.'}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <LinkButton href={`/track?order=${order.orderNumber}`} variant="outline">
                Track this order
              </LinkButton>
              <LinkButton href="/shop" variant="ghost">
                Continue shopping
              </LinkButton>
            </div>
          </div>
        )}

        <OrderDetailView
          order={order}
          items={order.items}
          shipments={order.shipments}
          refunds={order.refunds}
          returns={order.returns}
        />

        <div className="mt-6">
          <OrderActions
            orderNumber={order.orderNumber}
            canCancel={cancelCheck.can}
            cancelReasonHint={cancelCheck.can ? undefined : cancelCheck.reason}
            returnEligible={returnEligible}
            returnWindowDays={settings.policies.returnWindowDays}
            guestEmail={guestEmail}
            items={order.items.map((i) => ({
              id: i.id,
              name: ((i.productSnapshot as Record<string, unknown>)?.name as string) ?? 'Item',
            }))}
          />
        </div>

        <p className="mt-8 text-center text-xs text-ink-400">
          Something wrong with this order?{' '}
          <Link
            href={`/contact?subject=${encodeURIComponent(`Order ${order.orderNumber}`)}`}
            className="link-primary"
          >
            Contact support
          </Link>{' '}
          with your order number for the fastest help.
        </p>
      </div>
    </div>
  );
}
