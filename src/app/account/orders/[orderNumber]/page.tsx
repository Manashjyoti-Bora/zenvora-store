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

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Order details', robots: { index: false } };

type Ctx = { params: Promise<{ orderNumber: string }> };

export default async function AccountOrderDetail({ params }: Ctx) {
  const { orderNumber } = await params;
  const user = await getCurrentUser();
  if (!user) return null;

  let orderId: string;
  try {
    const accessible = await findOrderForAccess(orderNumber, user, null);
    orderId = accessible.id;
  } catch {
    notFound();
  }

  const [order, settings, cancelCheck] = await Promise.all([
    prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        shipments: { orderBy: { createdAt: 'desc' } },
        refunds: { orderBy: { createdAt: 'desc' } },
        returns: { orderBy: { createdAt: 'desc' } },
      },
    }),
    getSettings(),
    customerCanCancel(orderId),
  ]);

  const returnEligible =
    order.status === 'DELIVERED' &&
    settings.policies.returnWindowDays > 0 &&
    order.deliveredAt != null &&
    Date.now() - order.deliveredAt.getTime() <=
      settings.policies.returnWindowDays * 24 * 60 * 60 * 1000;

  const needsPayment =
    ['PENDING_PAYMENT', 'PAYMENT_FAILED'].includes(order.status) && order.paymentMethod !== 'COD';

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb">
        <Link
          href="/account/orders"
          className="text-sm font-medium text-brand-700 hover:text-brand-800"
        >
          ← Back to orders
        </Link>
      </nav>

      {needsPayment && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          This order is awaiting payment.{' '}
          <Link href={`/checkout/payment/${order.orderNumber}`} className="font-semibold underline">
            Complete payment now
          </Link>{' '}
          to confirm it.
        </div>
      )}

      <OrderDetailView
        order={order}
        items={order.items}
        shipments={order.shipments}
        refunds={order.refunds}
        returns={order.returns}
      />

      <OrderActions
        orderNumber={order.orderNumber}
        canCancel={cancelCheck.can}
        cancelReasonHint={cancelCheck.can ? undefined : cancelCheck.reason}
        returnEligible={returnEligible}
        returnWindowDays={settings.policies.returnWindowDays}
        items={order.items.map((i) => ({
          id: i.id,
          name: ((i.productSnapshot as Record<string, unknown>)?.name as string) ?? 'Item',
        }))}
      />
    </div>
  );
}
