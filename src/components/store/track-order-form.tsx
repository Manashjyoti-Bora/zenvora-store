'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { Button, Spinner } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Alert } from '@/components/ui/feedback';
import { Badge, OrderStatusBadge, FulfilmentStatusBadge } from '@/components/ui/badge';
import type { OrderStatus, OrderFulfilmentStatus } from '@prisma/client';

interface TrackResult {
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: string;
  fulfilmentStatus: OrderFulfilmentStatus;
  placedAt: string;
  total: string;
  items: Array<{
    name: string;
    variant: string | null;
    quantity: number;
    lineTotal: string;
    image: string | null;
  }>;
  shipments: Array<{
    carrier: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    status: string;
    shippedAt: string | null;
    deliveredAt: string | null;
    events: Array<{
      status: string;
      message: string | null;
      location: string | null;
      eventAt: string;
    }>;
  }>;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso)
  );
}

export function TrackOrderForm({ initialOrderNumber }: { initialOrderNumber?: string }) {
  const [orderNumber, setOrderNumber] = useState(initialOrderNumber ?? '');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TrackResult | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await apiFetch<TrackResult>('/api/track', {
        body: { orderNumber: orderNumber.trim(), email: email.trim() },
      });
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Could not look up the order. Please try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <form onSubmit={onSubmit} className="card space-y-4 p-5" noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Order number"
            required
            hint="e.g. RX-260905-A1B2C3 (from your confirmation email)"
          >
            {(p) => (
              <Input
                {...p}
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value.toUpperCase())}
                placeholder="RX-______-______"
                autoComplete="off"
                required
              />
            )}
          </Field>
          <Field label="Email used at checkout" required>
            {(p) => (
              <Input
                {...p}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            )}
          </Field>
        </div>
        <Button type="submit" size="lg" loading={busy} className="w-full sm:w-auto">
          Track order
        </Button>
        <p className="text-xs text-gray-400">
          For your privacy, guest tracking requires both the order number and the email used at
          checkout. Ordered with an account?{' '}
          <Link href="/auth/login?next=/account/orders" className="link-primary">
            Log in
          </Link>{' '}
          to see all your orders.
        </p>
      </form>

      {busy && (
        <div
          className="flex items-center justify-center gap-2 py-6 text-sm text-gray-500"
          role="status"
        >
          <Spinner className="h-5 w-5 text-brand-600" /> Looking up your order…
        </div>
      )}

      {error && !busy && (
        <Alert tone="error" title="Order not found">
          {error}
        </Alert>
      )}

      {result && !busy && (
        <div className="space-y-4">
          <section className="card p-5" aria-labelledby="track-status">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="track-status" className="text-base font-semibold text-gray-900">
                  Order {result.orderNumber}
                </h2>
                <p className="text-xs text-gray-500">
                  Placed {fmtDateTime(result.placedAt)} · Total {result.total}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <OrderStatusBadge status={result.status} />
                <FulfilmentStatusBadge status={result.fulfilmentStatus} />
              </div>
            </div>

            {result.shipments.length === 0 && (
              <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2.5 text-sm text-gray-600">
                Your order is being prepared. Tracking details will appear here (and in your email)
                as soon as it ships.
              </p>
            )}

            {result.shipments.map((s, i) => (
              <div key={i} className="mt-4 rounded-lg border border-gray-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900">
                    Shipment {result.shipments.length > 1 ? i + 1 : ''}
                    {s.carrier ? ` · ${s.carrier}` : ''}
                  </p>
                  <Badge
                    tone={
                      s.status === 'DELIVERED' ? 'green' : s.status === 'EXCEPTION' ? 'red' : 'blue'
                    }
                  >
                    {s.status.replace(/_/g, ' ')}
                  </Badge>
                </div>
                {s.trackingNumber && (
                  <p className="mt-1 text-xs text-gray-500">
                    Tracking number:{' '}
                    <span className="font-mono font-medium text-gray-800">{s.trackingNumber}</span>
                    {s.trackingUrl && (
                      <>
                        {' · '}
                        <a
                          href={s.trackingUrl}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="link-primary"
                        >
                          carrier tracking ↗
                        </a>
                      </>
                    )}
                  </p>
                )}
                {s.events.length > 0 && (
                  <ol className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                    {s.events.map((ev, j) => (
                      <li key={j} className="flex gap-3 text-xs">
                        <span
                          className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-500"
                          aria-hidden="true"
                        />
                        <div>
                          <p className="font-medium text-gray-800">
                            {ev.status.replace(/_/g, ' ')}
                            {ev.message ? ` — ${ev.message}` : ''}
                          </p>
                          <p className="text-gray-400">
                            {fmtDateTime(ev.eventAt)}
                            {ev.location ? ` · ${ev.location}` : ''}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
                {s.deliveredAt && (
                  <p className="mt-2 text-xs font-medium text-emerald-700">
                    Delivered {fmtDateTime(s.deliveredAt)}
                  </p>
                )}
              </div>
            ))}
          </section>

          <section className="card p-5" aria-labelledby="track-items">
            <h2 id="track-items" className="text-sm font-semibold text-gray-900">
              Items in this order
            </h2>
            <ul className="mt-3 divide-y divide-gray-100 text-sm">
              {result.items.map((it, i) => (
                <li key={i} className="flex justify-between gap-3 py-2">
                  <span className="text-gray-700">
                    {it.quantity} × <span className="font-medium">{it.name}</span>
                    {it.variant && <span className="text-xs text-gray-400"> ({it.variant})</span>}
                  </span>
                  <span className="shrink-0 tabular-nums">{it.lineTotal}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
