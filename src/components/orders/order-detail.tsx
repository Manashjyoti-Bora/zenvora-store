import Image from 'next/image';
import Link from 'next/link';
import { formatINR, toPaise } from '@/lib/money';
import { OrderStatusBadge, PaymentStatusBadge, FulfilmentStatusBadge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/feedback';
import type { Order, OrderItem, Shipment, Refund, ReturnRequest } from '@prisma/client';

export interface OrderDetailPayload {
  order: Order;
  items: OrderItem[];
  shipments: Shipment[];
  refunds: Refund[];
  returns: ReturnRequest[];
}

interface Snapshot {
  name?: string;
  slug?: string;
  variantName?: string | null;
  image?: string | null;
}

function snap(item: OrderItem): Snapshot {
  return (item.productSnapshot ?? {}) as Snapshot;
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

/** Order progress timeline derived from real timestamps only. */
function Timeline({ order, shipments }: { order: Order; shipments: Shipment[] }) {
  const shippedAt = shipments
    .map((s) => s.shippedAt)
    .filter(Boolean)
    .sort()[0] as Date | undefined;
  const cancelled = ['CANCELLED', 'REFUNDED', 'REFUND_PENDING'].includes(order.status);

  const steps = [
    { label: 'Order placed', at: order.placedAt ?? order.createdAt, done: true },
    {
      label: order.paymentMethod === 'COD' ? 'Confirmed (pay on delivery)' : 'Payment confirmed',
      at: order.paidAt ?? order.confirmedAt,
      done: Boolean(order.paidAt ?? order.confirmedAt) || order.paymentStatus === 'COD_PENDING',
    },
    { label: 'Shipped', at: shippedAt ?? null, done: Boolean(shippedAt) },
    { label: 'Delivered', at: order.deliveredAt ?? null, done: Boolean(order.deliveredAt) },
  ];

  if (cancelled) {
    return (
      <ol className="space-y-2 text-sm" aria-label="Order timeline">
        <li className="flex items-center gap-2 text-gray-500">
          <span aria-hidden="true">📦</span> Order placed{' '}
          {fmtDate(order.placedAt ?? order.createdAt)}
        </li>
        <li className="flex items-center gap-2 font-medium text-red-700">
          <span aria-hidden="true">✕</span>{' '}
          {order.status === 'REFUNDED'
            ? 'Cancelled & refunded'
            : order.status === 'REFUND_PENDING'
              ? 'Cancelled — refund in progress'
              : 'Cancelled'}{' '}
          {fmtDate(order.cancelledAt)}
          {order.cancelReason && (
            <span className="font-normal text-gray-500">({order.cancelReason})</span>
          )}
        </li>
      </ol>
    );
  }

  return (
    <ol className="space-y-0" aria-label="Order progress">
      {steps.map((s, i) => (
        <li key={s.label} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span
              className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                s.done ? 'border-brand-600 bg-brand-600' : 'border-gray-300 bg-white'
              }`}
              aria-hidden="true"
            >
              {s.done && (
                <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M2 6l3 3 5-6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            {i < steps.length - 1 && (
              <span
                className={`w-0.5 flex-1 ${s.done ? 'bg-brand-200' : 'bg-gray-200'}`}
                aria-hidden="true"
              />
            )}
          </div>
          <div className="pb-5">
            <p className={`text-sm ${s.done ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>
              {s.label}
            </p>
            <p className="text-xs text-gray-400">{s.done ? fmtDate(s.at) : 'Pending'}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function OrderDetailView({
  order,
  items,
  shipments,
  refunds,
  returns: returnRequests,
}: OrderDetailPayload) {
  const address = order.shippingAddress as Record<string, string | null>;
  const latestShipment = [...shipments].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  )[0];
  const refundedPaise = toPaise(order.refundedTotal);
  const pendingRefunds = refunds.filter((r) => ['REQUESTED', 'PROCESSING'].includes(r.status));

  return (
    <div className="space-y-6">
      {/* Status header */}
      <div className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400">Order</p>
            <p className="text-lg font-bold text-gray-900">{order.orderNumber}</p>
            <p className="text-xs text-gray-500">
              Placed {fmtDate(order.placedAt ?? order.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusBadge status={order.status} />
            <PaymentStatusBadge status={order.paymentStatus} />
            <FulfilmentStatusBadge status={order.fulfilmentStatus} />
          </div>
        </div>
        <div className="mt-4 border-t border-gray-100 pt-4">
          <Timeline order={order} shipments={shipments} />
        </div>
      </div>

      {/* Tracking */}
      {latestShipment?.trackingNumber && (
        <Alert tone="info" title="Tracking available">
          <p className="text-sm">
            Carrier: <strong>{latestShipment.carrier ?? '—'}</strong> · Tracking number:{' '}
            <strong className="font-mono">{latestShipment.trackingNumber}</strong>
          </p>
          {latestShipment.trackingUrl && (
            <p className="mt-1 text-sm">
              <a
                href={latestShipment.trackingUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="link-primary"
              >
                Track with carrier ↗
              </a>
            </p>
          )}
          <p className="mt-1 text-xs">
            Or use our{' '}
            <Link href={`/track?order=${order.orderNumber}`} className="link-primary">
              order tracking page
            </Link>
            .
          </p>
        </Alert>
      )}

      {/* Refund/return notices */}
      {pendingRefunds.length > 0 && (
        <Alert tone="info" title="Refund in progress">
          {formatINR(toPaise(pendingRefunds.reduce((a, r) => a + toPaise(r.amount), 0)))} is being
          refunded to your original payment method. Refunds typically take 5–7 business days after
          processing.
        </Alert>
      )}
      {returnRequests.length > 0 && (
        <Alert tone="info" title={`Return request${returnRequests.length === 1 ? '' : 's'}`}>
          <ul className="list-disc space-y-1 pl-4 text-sm">
            {returnRequests.map((r) => (
              <li key={r.id}>
                <span className="font-medium">{r.status.replace(/_/g, ' ')}</span> — {r.reason}
                <span className="text-xs text-gray-400"> (requested {fmtDate(r.createdAt)})</span>
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {/* Items */}
      <section className="card" aria-labelledby="order-items">
        <header className="border-b border-gray-200 px-4 py-3 sm:px-5">
          <h2 id="order-items" className="text-base font-semibold text-gray-900">
            Items ({items.length})
          </h2>
        </header>
        <ul className="divide-y divide-gray-100">
          {items.map((item) => {
            const s = snap(item);
            return (
              <li key={item.id} className="flex gap-3 p-4">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                  {s.image ? (
                    <Image
                      src={s.image}
                      alt={s.name ?? 'Order item'}
                      fill
                      sizes="64px"
                      className="object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span
                      className="flex h-full items-center justify-center text-xl text-gray-300"
                      aria-hidden="true"
                    >
                      🛍️
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {s.slug ? (
                    <Link
                      href={`/products/${s.slug}`}
                      className="line-clamp-2 text-sm font-semibold text-gray-900 hover:text-brand-700"
                    >
                      {s.name ?? 'Product'}
                    </Link>
                  ) : (
                    <p className="line-clamp-2 text-sm font-semibold text-gray-900">
                      {s.name ?? 'Product'}
                    </p>
                  )}
                  {s.variantName && <p className="text-xs text-gray-500">{s.variantName}</p>}
                  <p className="mt-0.5 text-xs tabular-nums text-gray-400">
                    {item.quantity} × {formatINR(toPaise(item.unitPrice))}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-bold tabular-nums text-gray-900">
                  {formatINR(toPaise(item.lineTotal))}
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Totals */}
        <section className="card p-4 sm:p-5" aria-labelledby="order-totals">
          <h2 id="order-totals" className="text-base font-semibold text-gray-900">
            Payment summary
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500">Subtotal</dt>
              <dd className="tabular-nums">{formatINR(toPaise(order.subtotal))}</dd>
            </div>
            {toPaise(order.discountTotal) > 0 && (
              <div className="flex justify-between gap-4 text-emerald-700">
                <dt>Discount {order.couponCode ? `(${order.couponCode})` : ''}</dt>
                <dd className="tabular-nums">−{formatINR(toPaise(order.discountTotal))}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500">Shipping</dt>
              <dd className="tabular-nums">
                {toPaise(order.shippingTotal) - toPaise(order.codFeeTotal) === 0
                  ? 'FREE'
                  : formatINR(toPaise(order.shippingTotal) - toPaise(order.codFeeTotal))}
              </dd>
            </div>
            {toPaise(order.codFeeTotal) > 0 && (
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">COD handling fee</dt>
                <dd className="tabular-nums">{formatINR(toPaise(order.codFeeTotal))}</dd>
              </div>
            )}
            {refundedPaise > 0 && (
              <div className="flex justify-between gap-4 text-gray-500">
                <dt>Refunded</dt>
                <dd className="tabular-nums">−{formatINR(refundedPaise)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4 border-t border-gray-200 pt-3 text-base">
              <dt className="font-semibold text-gray-900">
                {refundedPaise > 0 ? 'Order total' : 'Total paid'}
              </dt>
              <dd className="font-bold tabular-nums">{formatINR(toPaise(order.grandTotal))}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-gray-400">
            Payment method:{' '}
            {order.paymentMethod === 'COD' ? 'Cash on Delivery' : 'Online (gateway)'}
            {order.paidAt ? ` · Paid ${fmtDate(order.paidAt)}` : ''}
          </p>
        </section>

        {/* Address */}
        <section className="card p-4 sm:p-5" aria-labelledby="order-address">
          <h2 id="order-address" className="text-base font-semibold text-gray-900">
            Shipping address
          </h2>
          <address className="mt-3 text-sm not-italic leading-relaxed text-gray-700">
            <span className="font-semibold text-gray-900">{address.fullName}</span>
            <br />
            {address.line1}
            {address.line2 && (
              <>
                {', '}
                <br />
                {address.line2}
              </>
            )}
            <br />
            {address.city}, {address.state} — {address.postalCode}
            <br />
            {address.country}
            <br />
            📞 {address.phone}
          </address>
          {order.customerNote && (
            <p className="mt-3 rounded-lg bg-gray-50 p-2.5 text-xs text-gray-600">
              <span className="font-medium">Delivery note:</span> {order.customerNote}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

export { fmtDate as formatOrderDate };
