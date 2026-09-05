import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/guards';
import { findOrderForAccess } from '@/lib/orders/access';
import { toPaise, formatINR } from '@/lib/money';
import { PaymentFlow } from '@/components/checkout/payment-flow';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Complete payment',
  robots: { index: false },
};

type Ctx = { params: Promise<{ orderNumber: string }> };

export default async function PaymentPage({
  params,
  searchParams,
}: Ctx & { searchParams: Promise<{ email?: string }> }) {
  const { orderNumber } = await params;
  const sp = await searchParams;
  const user = await getCurrentUser();

  let order;
  try {
    order = await findOrderForAccess(orderNumber, user, sp.email ?? null);
  } catch {
    notFound();
  }

  if (order.paymentMethod === 'COD') {
    redirect(
      `/order/${order.orderNumber}/confirmation${!user && order.guestEmail ? `?email=${encodeURIComponent(order.guestEmail)}` : ''}`
    );
  }
  if (
    order.paymentStatus === 'PAID' ||
    ['DELIVERED', 'CANCELLED', 'REFUNDED'].includes(order.status)
  ) {
    redirect(
      `/order/${order.orderNumber}/confirmation${!user && order.guestEmail ? `?email=${encodeURIComponent(order.guestEmail)}` : ''}`
    );
  }

  return (
    <div className="container-store max-w-xl py-10 sm:py-16">
      <h1 className="text-center text-2xl">Complete your payment</h1>
      <p className="mt-2 text-center text-sm text-gray-500">
        Order <span className="font-semibold text-gray-800">{order.orderNumber}</span> · Amount{' '}
        <span className="font-semibold tabular-nums text-gray-800">
          {formatINR(toPaise(order.grandTotal))}
        </span>
      </p>
      <div className="mt-8">
        <PaymentFlow
          orderNumber={order.orderNumber}
          amountPaise={toPaise(order.grandTotal)}
          guestEmail={order.guestEmail ?? undefined}
          initialFailure={
            order.status === 'PAYMENT_FAILED'
              ? 'The previous payment attempt failed. You can retry below — your order and items are reserved.'
              : null
          }
        />
      </div>
    </div>
  );
}
