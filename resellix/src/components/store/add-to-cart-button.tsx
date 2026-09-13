'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';

export function AddToCartButton({
  productId,
  variantId,
  qty = 1,
  disabled = false,
  compact = false,
  goToList = false,
  label,
  disabledLabel,
}: {
  productId: string;
  variantId?: string;
  qty?: number;
  disabled?: boolean;
  compact?: boolean;
  goToList?: boolean;
  label?: string;
  /** Copy shown while disabled. Defaults to 'Sold out'; pass 'Buy now' etc.
      when the disabled reason is NOT stock (e.g. variant not chosen). */
  disabledLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function add() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await apiFetch<{ count: number }>('/api/cart', {
        body: { productId, variantId: variantId ?? null, quantity: qty },
      });
      toast(`Added to cart (${result.count} item${result.count === 1 ? '' : 's'})`, 'success');
      router.refresh();
      if (goToList) router.push('/cart');
    } catch (err) {
      if (err instanceof ApiClientError) {
        toast(err.message, 'error');
      } else {
        toast('Could not reach the server. Please try again.', 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  if (compact) {
    return (
      <Button
        type="button"
        size="sm"
        variant={disabled ? 'outline' : 'primary'}
        onClick={add}
        loading={busy}
        disabled={disabled}
        aria-label={disabled ? disabledLabel ?? 'Sold out' : 'Add to cart'}
      >
        {disabled ? disabledLabel ?? 'Sold out' : busy ? '' : '+ Add'}
      </Button>
    );
  }

  const baseLabel = label ?? 'Add to cart';
  return (
    <Button
      type="button"
      size="lg"
      variant={goToList ? 'secondary' : 'primary'}
      onClick={add}
      loading={busy}
      disabled={disabled}
      className="w-full sm:w-auto"
    >
      {busy ? (goToList ? 'Redirecting…' : 'Adding…') : disabled ? disabledLabel ?? 'Sold out' : baseLabel}
    </Button>
  );
}
