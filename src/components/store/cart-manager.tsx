'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button, LinkButton, Spinner } from '@/components/ui/button';
import { QuantityStepper } from './quantity-stepper';
import { Input } from '@/components/ui/form';
import { formatINR } from '@/lib/money';
import { Alert } from '@/components/ui/feedback';
import type { CartView } from '@/lib/cart/service';

/**
 * Cart page interactions: quantity changes, line removal and coupon
 * apply/remove - all hitting the cart API then refreshing server state.
 */
export function CartManager({
  initialCart,
  isLoggedIn,
}: {
  initialCart: CartView;
  isLoggedIn: boolean;
}) {
  const router = useRouter();
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [couponInput, setCouponInput] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(initialCart.couponError);
  const cart = initialCart;

  async function run(fn: () => Promise<unknown>, errorPrefix: string) {
    try {
      await fn();
      router.refresh();
    } catch (err) {
      toast(
        err instanceof ApiClientError ? err.message : `${errorPrefix}. Please try again.`,
        'error'
      );
    }
  }

  async function updateQty(
    itemId: string,
    productId: string,
    variantId: string | null,
    quantity: number
  ) {
    setBusyItem(itemId);
    await run(
      () =>
        apiFetch(`/api/cart/item`, {
          method: 'PATCH',
          body: { itemId, productId, variantId, quantity },
        }),
      'Could not update quantity'
    );
    setBusyItem(null);
  }

  async function removeItem(itemId: string) {
    setBusyItem(itemId);
    await run(
      () => apiFetch(`/api/cart/item`, { method: 'DELETE', body: { itemId } }),
      'Could not remove item'
    );
    setBusyItem(null);
  }

  async function applyCoupon() {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    setCouponBusy(true);
    setCouponError(null);
    try {
      await apiFetch('/api/cart/coupon', { body: { code } });
      setCouponInput('');
      toast('Coupon applied', 'success');
      router.refresh();
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : 'Could not apply coupon';
      setCouponError(msg);
    } finally {
      setCouponBusy(false);
    }
  }

  async function removeCoupon() {
    setCouponBusy(true);
    await run(() => apiFetch('/api/cart/coupon', { method: 'DELETE' }), 'Could not remove coupon');
    setCouponBusy(false);
  }

  if (cart.isEmpty) {
    return (
      <div className="py-10 text-center">
        <p className="text-4xl" aria-hidden="true">
          🛒
        </p>
        <h2 className="mt-3 text-lg font-semibold text-gray-900">Your cart is empty</h2>
        <p className="mt-1 text-sm text-gray-500">Browse the catalog and add something you like.</p>
        <div className="mt-5">
          <LinkButton href="/shop" size="lg">
            Start shopping
          </LinkButton>
        </div>
      </div>
    );
  }

  const unavailable = cart.lines.filter((l) => !l.available);

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        {unavailable.length > 0 && (
          <Alert tone="warning" title="Some items changed">
            {unavailable.map((l) => l.name).join(', ')} — stock is no longer sufficient. Adjust the
            quantity or remove the item to continue.
          </Alert>
        )}
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {cart.lines.map((line) => (
            <li key={line.itemId} className="flex gap-3 p-4">
              <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-cream-100">
                {line.image ? (
                  <Image
                    src={line.image}
                    alt={line.name}
                    fill
                    sizes="80px"
                    className="object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span
                    className="flex h-full items-center justify-center text-2xl text-gray-300"
                    aria-hidden="true"
                  >
                    🛍️
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/products/${line.slug}`}
                      className="line-clamp-2 text-sm font-semibold text-gray-900 hover:text-brand-700"
                    >
                      {line.name}
                    </Link>
                    {line.variantName && (
                      <p className="mt-0.5 text-xs text-gray-500">{line.variantName}</p>
                    )}
                    <p className="mt-0.5 text-xs tabular-nums text-gray-400">
                      {formatINR(line.unitPricePaise)} each
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-bold tabular-nums text-gray-900">
                    {formatINR(line.lineTotalPaise)}
                  </p>
                </div>
                <div className="mt-2.5 flex items-center gap-2">
                  {busyItem === line.itemId ? (
                    <Spinner className="h-5 w-5 text-brand-600" />
                  ) : (
                    <QuantityStepper
                      value={line.quantity}
                      min={1}
                      max={line.maxQuantity || 1}
                      onChange={(q) => updateQty(line.itemId, line.productId, line.variantId, q)}
                      label={`Quantity for ${line.name}`}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => removeItem(line.itemId)}
                    disabled={busyItem === line.itemId}
                    className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    Remove
                  </button>
                  {!line.available && (
                    <span className="text-xs font-medium text-amber-600">
                      Only {line.maxQuantity} available
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/shop" className="text-sm font-medium text-brand-700 hover:text-brand-800">
            ← Continue shopping
          </Link>
        </div>
      </div>

      {/* Summary */}
      <aside className="h-fit space-y-4 lg:sticky lg:top-20" aria-label="Order summary">
        <div className="card p-4 sm:p-5">
          <h2 className="text-base font-semibold text-gray-900">Order summary</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500">
                Subtotal ({cart.itemCount} item{cart.itemCount === 1 ? '' : 's'})
              </dt>
              <dd className="font-medium tabular-nums">{formatINR(cart.subtotalPaise)}</dd>
            </div>
            {cart.coupon && (
              <div className="flex justify-between gap-4 text-emerald-700">
                <dt>Coupon {cart.coupon.code}</dt>
                <dd className="font-medium tabular-nums">
                  −{formatINR(cart.coupon.discountPaise)}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-gray-500">Shipping</dt>
              <dd className="font-medium tabular-nums">
                {cart.shippingPaise === 0 ? (
                  <span className="text-emerald-700">FREE</span>
                ) : (
                  formatINR(cart.shippingPaise)
                )}
              </dd>
            </div>
            {cart.freeShippingApplied && (
              <p className="text-xs text-emerald-600">Free shipping applied 🎉</p>
            )}
            {!cart.freeShippingApplied && cart.freeShippingThresholdPaise > 0 && (
              <p className="text-xs text-gray-400">
                Add{' '}
                {formatINR(
                  cart.freeShippingThresholdPaise -
                    (cart.subtotalPaise - (cart.coupon?.discountPaise ?? 0))
                )}{' '}
                more for free shipping
              </p>
            )}
            <div className="flex justify-between gap-4 border-t border-gray-200 pt-3 text-base">
              <dt className="font-semibold text-gray-900">Total</dt>
              <dd className="font-bold tabular-nums">{formatINR(cart.grandTotalPaise)}</dd>
            </div>
          </dl>

          <div className="mt-4">
            <LinkButton href="/checkout" size="lg" className="w-full">
              Proceed to checkout
            </LinkButton>
            {!isLoggedIn && (
              <p className="mt-2 text-center text-xs text-gray-400">
                You can check out as a guest or{' '}
                <Link href="/auth/login?next=/checkout" className="link-primary">
                  log in
                </Link>{' '}
                for faster checkout.
              </p>
            )}
          </div>
        </div>

        <div className="card p-4">
          <h2 className="text-sm font-semibold text-gray-900">Have a coupon?</h2>
          {cart.coupon ? (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2">
              <p className="text-sm font-medium text-emerald-700">{cart.coupon.code} applied</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={removeCoupon}
                disabled={couponBusy}
                className="text-emerald-700 hover:bg-emerald-100"
              >
                Remove
              </Button>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <div className="flex gap-2">
                <Input
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                  placeholder="e.g. WELCOME10"
                  aria-label="Coupon code"
                  aria-invalid={Boolean(couponError)}
                  className="uppercase"
                  maxLength={40}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={applyCoupon}
                  loading={couponBusy}
                  disabled={!couponInput.trim()}
                >
                  Apply
                </Button>
              </div>
              {couponError && (
                <p role="alert" className="text-xs font-medium text-red-600">
                  {couponError}
                </p>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
