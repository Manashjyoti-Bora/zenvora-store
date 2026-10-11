'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

export function WishlistButton({
  productId,
  initialSaved = false,
  compact = false,
  className,
}: {
  productId: string;
  initialSaved?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    const nextState = !saved;
    setSaved(nextState);
    try {
      if (nextState) {
        await apiFetch('/api/wishlist', {
          method: 'POST',
          body: { productId },
        });
        toast('Saved to wishlist', 'success');
      } else {
        await apiFetch(`/api/wishlist?productId=${encodeURIComponent(productId)}`, {
          method: 'DELETE',
        });
        toast('Removed from wishlist', 'info');
      }
      router.refresh();
    } catch (err) {
      setSaved(!nextState);
      if (err instanceof ApiClientError) {
        toast(err.message, 'error');
      } else {
        toast('Could not update wishlist. Please try again.', 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={saved}
        aria-label={saved ? 'Remove from wishlist' : 'Save to wishlist'}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-full border border-ink-900/10 bg-white/90 text-ink-600 shadow-hair backdrop-blur-sm transition-colors hover:bg-white hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
          saved && 'border-rose-200 bg-rose-50/95 text-rose-600',
          className
        )}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill={saved ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={saved}
      aria-label={saved ? 'Remove from wishlist' : 'Save to wishlist'}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl border border-ink-900/15 bg-white px-4 py-2.5 text-sm font-semibold text-ink-800 shadow-hair transition-colors hover:bg-cream-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
        saved && 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100/70',
        className
      )}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill={saved ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
      <span>{saved ? 'Saved in wishlist' : 'Save to wishlist'}</span>
    </button>
  );
}
