import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { toPaise, formatINR } from '@/lib/money';
import { Card, Alert } from '@/components/ui/feedback';
import {
  Badge,
  OrderStatusBadge,
  PaymentStatusBadge,
  FulfilmentStatusBadge,
  GatewayPaymentStatusBadge,
} from '@/components/ui/badge';
import { TableWrap, Th, Td } from '@/components/ui/table';
import { OrderAdminActions } from '@/components/admin/order-admin-actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Order — Admin', robots: { index: false } };

type Ctx = { params: Promise<{ id: string }> };

const fmt = (d: Date | null) =>
  d ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d) : '—';

export default async function AdminOrderDetail({ params }: Ctx) {
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: { orderBy: { createdAt: 'asc' } },
      payments: { orderBy: { createdAt: 'desc' } },
      supplierOrders: { orderBy: { createdAt: 'desc' } },
      shipments: {
        orderBy: { createdAt: 'desc' },
        include: { events: { orderBy: { eventAt: 'desc' } } },
      },
      refunds: { orderBy: { createdAt: 'desc' } },
      returns: { orderBy: { createdAt: 'desc' } },
      events: { orderBy: { createdAt: 'desc' }, take: 60 },
      user: { select: { id: true, name: true, email: true, phone: true } },
    },
  });
  if (!order) notFound();

  const address = order.shippingAddress as Record<string, string | null>;
  const revenue = toPaise(order.grandTotal);
  const refunded = toPaise(order.refundedTotal);
  const costs = {
    supplier: toPaise(order.supplierCostTotal),
    shipping: toPaise(order.shippingCostTotal),
    fees: toPaise(order.paymentFeeTotal),
    other: toPaise(order.otherCostTotal),
  };
  const totalCosts = costs.supplier + costs.shipping + costs.fees + costs.other;
  const grossMargin = revenue - costs.supplier; // NEVER label this as profit
  const actualProfit = toPaise(order.actualProfit);
  const finalized =
    order.profitFinalizedAt != null ||
    ['DELIVERED', 'REFUNDED', 'CANCELLED'].includes(order.status);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/orders" className="text-xs font-medium text-brand-700 hover:underline">
            ← All orders
          </Link>
          <h1 className="mt-1 font-mono">{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-gray-500">
            Placed {fmt(order.placedAt ?? order.createdAt)}
            {order.payments.some((p) => p.provider === 'TEST') && (
              <Badge tone="amber" className="ml-2">
                TEST payment
              </Badge>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <OrderStatusBadge status={order.status} />
          <PaymentStatusBadge status={order.paymentStatus} />
          <FulfilmentStatusBadge status={order.fulfilmentStatus} />
        </div>
      </header>

      {order.status === 'FULFILMENT_FAILED' && (
        <Alert tone="error" title="Fulfilment failed">
          The supplier order could not be completed automatically. Review the supplier orders below,
          then retry, fulfil manually (record a shipment), or cancel with refund.
        </Alert>
      )}

      <OrderAdminActions
        order={{
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          paymentStatus: order.paymentStatus,
          paymentMethod: order.paymentMethod,
          grandTotalPaise: revenue,
          refundedPaise: refunded,
          shippingCostPaise: costs.shipping,
          otherCostPaise: costs.other,
        }}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-5">
          {/* Items */}
          <Card title={`Items (${order.items.length})`} padded={false}>
            <TableWrap className="border-0">
              <table className="table-base">
                <thead className="bg-gray-50">
                  <tr>
                    <Th>Product</Th>
                    <Th className="hidden sm:table-cell">Unit price</Th>
                    <Th className="hidden lg:table-cell">Unit cost</Th>
                    <Th>Qty</Th>
                    <Th>Line total</Th>
                    <Th className="hidden lg:table-cell">Line est. profit</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {order.items.map((item) => {
                    const snap = item.productSnapshot as {
                      name?: string;
                      variantName?: string | null;
                      slug?: string;
                      image?: string | null;
                    };
                    return (
                      <tr key={item.id}>
                        <Td>
                          <p className="max-w-[220px] truncate font-medium text-gray-900">
                            {snap?.name ?? 'Product'}
                          </p>
                          <p className="text-[11px] text-gray-400">
                            {snap?.variantName ? `${snap.variantName} · ` : ''}
                            {item.sku ?? snap?.slug ?? ''}
                            {item.supplierSku ? ` · sup: ${item.supplierSku}` : ''}
                          </p>
                        </Td>
                        <Td className="hidden tabular-nums sm:table-cell">
                          {formatINR(toPaise(item.unitPrice))}
                        </Td>
                        <Td className="hidden tabular-nums text-gray-500 lg:table-cell">
                          {formatINR(
                            toPaise(item.unitSupplierCost) +
                              toPaise(item.unitSupplierShipping) +
                              toPaise(item.unitOtherCost)
                          )}
                        </Td>
                        <Td className="tabular-nums">{item.quantity}</Td>
                        <Td className="font-medium tabular-nums">
                          {formatINR(toPaise(item.lineTotal))}
                          {toPaise(item.lineDiscount) > 0 && (
                            <span className="block text-[10px] text-emerald-600">
                              −{formatINR(toPaise(item.lineDiscount))} discount
                            </span>
                          )}
                        </Td>
                        <Td className="hidden tabular-nums lg:table-cell">
                          <span
                            className={
                              toPaise(item.lineEstimatedProfit) >= 0
                                ? 'text-emerald-700'
                                : 'text-red-700'
                            }
                          >
                            {formatINR(toPaise(item.lineEstimatedProfit))}
                          </span>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          </Card>

          {/* Supplier orders */}
          <Card title={`Supplier orders (${order.supplierOrders.length})`} padded={false}>
            {order.supplierOrders.length === 0 ? (
              <p className="p-4 text-sm text-gray-400">
                No supplier order created — manual fulfilment, or fulfilment has not been triggered
                yet.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {order.supplierOrders.map((so) => (
                  <li
                    key={so.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900">
                        {so.status.replace(/_/g, ' ')}
                        {so.supplierOrderId ? (
                          <span className="ml-2 font-mono text-xs text-gray-400">
                            {so.supplierOrderId}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-[11px] text-gray-400">
                        {so.attempts} attempt{so.attempts === 1 ? '' : 's'} · updated{' '}
                        {fmt(so.updatedAt)}
                        {so.lastError ? (
                          <span className="ml-1 text-red-500">· {so.lastError.slice(0, 80)}</span>
                        ) : (
                          ''
                        )}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Badge
                        tone={
                          so.status === 'FAILED' || so.status === 'REJECTED'
                            ? 'red'
                            : so.status === 'DELIVERED'
                              ? 'green'
                              : 'blue'
                        }
                      >
                        {so.status}
                      </Badge>
                      {so.status !== 'DELIVERED' && so.status !== 'CANCELLED' && (
                        <Link
                          href={`/admin/supplier-orders?focus=${so.id}`}
                          className="text-xs font-medium text-brand-700 hover:underline"
                        >
                          Manage →
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Shipments */}
          <Card title={`Shipments (${order.shipments.length})`} padded={false}>
            {order.shipments.length === 0 ? (
              <p className="p-4 text-sm text-gray-400">No shipment recorded yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {order.shipments.map((s) => (
                  <li key={s.id} className="px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-gray-900">
                        {s.carrier ?? 'Carrier not specified'}
                        {s.trackingNumber && (
                          <span className="ml-2 font-mono text-xs text-gray-500">
                            {s.trackingNumber}
                          </span>
                        )}
                      </p>
                      <Badge
                        tone={
                          s.status === 'DELIVERED'
                            ? 'green'
                            : s.status === 'EXCEPTION'
                              ? 'red'
                              : 'blue'
                        }
                      >
                        {s.status.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    {s.trackingUrl && (
                      <a
                        href={s.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="link-primary text-xs"
                      >
                        Carrier tracking ↗
                      </a>
                    )}
                    {s.events.length > 0 && (
                      <ul className="mt-2 space-y-1 border-t border-gray-100 pt-2">
                        {s.events.slice(0, 6).map((ev) => (
                          <li key={ev.id} className="text-xs text-gray-500">
                            <span className="font-medium text-gray-700">
                              {ev.status.replace(/_/g, ' ')}
                            </span>
                            {ev.message ? ` — ${ev.message}` : ''}
                            <span className="ml-1 text-gray-400">
                              {fmt(ev.eventAt)}
                              {ev.location ? ` · ${ev.location}` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Payments */}
          <Card title={`Payment attempts (${order.payments.length})`} padded={false}>
            {order.payments.length === 0 ? (
              <p className="p-4 text-sm text-gray-400">
                No payment attempts recorded (COD or not started).
              </p>
            ) : (
              <TableWrap className="border-0">
                <table className="table-base">
                  <thead className="bg-gray-50">
                    <tr>
                      <Th>Provider</Th>
                      <Th className="hidden sm:table-cell">Provider order</Th>
                      <Th className="hidden md:table-cell">Payment ID</Th>
                      <Th>Amount</Th>
                      <Th>Fee</Th>
                      <Th>Status</Th>
                      <Th className="hidden lg:table-cell">When</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {order.payments.map((p) => (
                      <tr key={p.id}>
                        <Td>
                          {p.provider}
                          {p.provider === 'TEST' && (
                            <Badge tone="amber" className="ml-1">
                              TEST
                            </Badge>
                          )}
                        </Td>
                        <Td className="hidden max-w-[140px] truncate font-mono text-[11px] text-gray-500 sm:table-cell">
                          {p.providerOrderId}
                        </Td>
                        <Td className="hidden max-w-[140px] truncate font-mono text-[11px] text-gray-500 md:table-cell">
                          {p.providerPaymentId ?? '—'}
                        </Td>
                        <Td className="tabular-nums">{formatINR(toPaise(p.amount))}</Td>
                        <Td className="tabular-nums text-gray-500">
                          {p.feeAmount != null ? formatINR(toPaise(p.feeAmount)) : '—'}
                        </Td>
                        <Td>
                          <GatewayPaymentStatusBadge status={p.status} />
                        </Td>
                        <Td className="hidden text-[11px] text-gray-400 lg:table-cell">
                          {fmt(p.createdAt)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>

          {/* Returns & refunds */}
          {(order.returns.length > 0 || order.refunds.length > 0) && (
            <Card title="Returns & refunds" padded={false}>
              <ul className="divide-y divide-gray-100 text-sm">
                {order.returns.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                  >
                    <span className="text-gray-700">
                      Return: {r.reason}
                      {r.adminNote ? ` — ${r.adminNote}` : ''}
                    </span>
                    <span className="flex items-center gap-2">
                      {r.refundAmount != null && (
                        <span className="tabular-nums text-gray-500">
                          {formatINR(toPaise(r.refundAmount))}
                        </span>
                      )}
                      <Badge
                        tone={
                          r.status === 'APPROVED' || r.status === 'REFUNDED'
                            ? 'green'
                            : r.status === 'REJECTED'
                              ? 'red'
                              : 'amber'
                        }
                      >
                        {r.status.replace(/_/g, ' ')}
                      </Badge>
                    </span>
                  </li>
                ))}
                {order.refunds.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                  >
                    <span className="text-gray-700">
                      Refund: {r.reason ?? 'no reason recorded'}
                      {r.failureReason ? ` — failed: ${r.failureReason}` : ''}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-medium tabular-nums">
                        {formatINR(toPaise(r.amount))}
                      </span>
                      <Badge
                        tone={
                          r.status === 'COMPLETED'
                            ? 'green'
                            : r.status === 'FAILED'
                              ? 'red'
                              : 'amber'
                        }
                      >
                        {r.status}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Event audit trail */}
          <Card
            title={`Event log (${order.events.length}${order.events.length >= 60 ? ' newest 60' : ''})`}
            padded={false}
          >
            <ol className="max-h-96 divide-y divide-gray-50 overflow-y-auto">
              {order.events.map((ev) => (
                <li key={ev.id} className="flex flex-wrap items-baseline gap-x-2 px-4 py-2 text-xs">
                  <span className="font-mono text-gray-400">{fmt(ev.createdAt)}</span>
                  <Badge tone="neutral">{ev.type}</Badge>
                  {ev.fromStatus && ev.toStatus && (
                    <span className="text-gray-500">
                      {ev.fromStatus.replace(/_/g, ' ')} → {ev.toStatus.replace(/_/g, ' ')}
                    </span>
                  )}
                  {ev.message && <span className="text-gray-600">{ev.message}</span>}
                  <span className="ml-auto text-gray-400">{ev.actorType.toLowerCase()}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        {/* Right rail: money + customer */}
        <div className="space-y-5">
          <Card title="Money & profit">
            <dl className="space-y-1.5 text-sm">
              <Row label="Subtotal" value={formatINR(toPaise(order.subtotal))} />
              {toPaise(order.discountTotal) > 0 && (
                <Row
                  label={`Discount${order.couponCode ? ` (${order.couponCode})` : ''}`}
                  value={`−${formatINR(toPaise(order.discountTotal))}`}
                  tone="text-emerald-700"
                />
              )}
              <Row
                label="Shipping charged"
                value={formatINR(toPaise(order.shippingTotal) - toPaise(order.codFeeTotal))}
              />
              {toPaise(order.codFeeTotal) > 0 && (
                <Row label="COD fee charged" value={formatINR(toPaise(order.codFeeTotal))} />
              )}
              <Row label="Revenue (grand total)" value={formatINR(revenue)} strong />
              {refunded > 0 && (
                <Row label="Refunded" value={`−${formatINR(refunded)}`} tone="text-red-700" />
              )}
            </dl>
            <div className="my-3 border-t border-gray-200" />
            <dl className="space-y-1.5 text-sm">
              <Row label="Supplier cost" value={formatINR(costs.supplier)} />
              <Row label="Shipping cost (actual)" value={formatINR(costs.shipping)} />
              <Row label="Gateway/COD fees" value={formatINR(costs.fees)} />
              <Row label="Other costs" value={formatINR(costs.other)} />
              <Row label="Total costs" value={formatINR(totalCosts)} strong />
            </dl>
            <div className="my-3 border-t border-gray-200" />
            <dl className="space-y-1.5 text-sm">
              <Row
                label="Gross margin (pre-fees)"
                value={formatINR(grossMargin)}
                muted
                note="revenue − supplier cost only"
              />
              <div className="flex items-baseline justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2">
                <dt className="text-sm font-semibold text-gray-900">Actual profit</dt>
                <dd
                  className={`text-lg font-bold tabular-nums ${actualProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}
                >
                  {formatINR(actualProfit)}
                </dd>
              </div>
              <p className="text-[11px] leading-relaxed text-gray-400">
                {finalized
                  ? 'Finalised: all supplier costs, shipping, fees and refunds are recorded.'
                  : 'ESTIMATE — fulfilment is still open. Costs (supplier shipping, courier fees, refunds) can still change; the figure is finalised when the order completes.'}
              </p>
            </dl>
          </Card>

          <Card title="Customer">
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs text-gray-400">Name</dt>
                <dd className="font-medium text-gray-900">
                  {order.user?.name ?? order.guestName ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Email</dt>
                <dd className="break-all text-gray-700">
                  {order.user?.email ?? order.guestEmail ?? '—'}
                  {order.user && (
                    <Link
                      href={`/admin/customers?q=${encodeURIComponent(order.user.email)}`}
                      className="ml-2 text-xs text-brand-700 hover:underline"
                    >
                      view
                    </Link>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Phone</dt>
                <dd className="text-gray-700">{order.user?.phone ?? order.guestPhone ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Shipping address</dt>
                <dd className="text-gray-700">
                  {address.fullName}
                  <br />
                  {address.line1}
                  {address.line2 ? `, ${address.line2}` : ''}
                  <br />
                  {address.city}, {address.state} — {address.postalCode}
                  <br />
                  {address.country} · {address.phone}
                </dd>
              </div>
              {order.customerNote && (
                <div>
                  <dt className="text-xs text-gray-400">Delivery note</dt>
                  <dd className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                    {order.customerNote}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-gray-400">Account type</dt>
                <dd>
                  {order.user ? (
                    <Badge tone="blue">Registered</Badge>
                  ) : (
                    <Badge tone="neutral">Guest</Badge>
                  )}
                </dd>
              </div>
            </dl>
          </Card>

          <Card title="Timestamps">
            <dl className="space-y-1.5 text-xs text-gray-600">
              <Row label="Created" value={fmt(order.createdAt)} small />
              <Row label="Placed" value={fmt(order.placedAt)} small />
              <Row label="Paid" value={fmt(order.paidAt)} small />
              <Row label="Confirmed" value={fmt(order.confirmedAt)} small />
              <Row label="Delivered" value={fmt(order.deliveredAt)} small />
              <Row label="Cancelled" value={fmt(order.cancelledAt)} small />
            </dl>
            {order.cancelReason && (
              <p className="mt-2 text-xs text-red-600">
                Cancel reason: {order.cancelReason} (by {order.cancelledBy?.toLowerCase()})
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  tone,
  muted,
  note,
  small,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: string;
  muted?: boolean;
  note?: string;
  small?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={small ? 'text-gray-500' : muted ? 'text-gray-400' : 'text-gray-500'}>
        {label}
        {note && <span className="block text-[10px] text-gray-300">{note}</span>}
      </dt>
      <dd
        className={`tabular-nums ${tone ?? ''} ${strong ? 'font-semibold text-gray-900' : 'text-gray-700'}`}
      >
        {value}
      </dd>
    </div>
  );
}
