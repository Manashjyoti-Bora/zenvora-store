'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { formatINR } from '@/lib/money';
import { toast } from '@/components/ui/toaster';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AddToCartButton } from '@/components/store/add-to-cart-button';
import type { WishlistView } from '@/lib/wishlist/service';

export function WishlistManager({
  initialWishlist,
  isLoggedIn,
}: {
  initialWishlist: WishlistView;
  isLoggedIn: boolean;
}) {
  const [wishlist, setWishlist] = useState<WishlistView>(initialWishlist);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const router = useRouter();

  async function removeItem(productId: string) {
    if (removingId) return;
    setRemovingId(productId);
    try {
      const next = await apiFetch<WishlistView>(
        `/api/wishlist?productId=${encodeURIComponent(productId)}`,
        { method: 'DELETE' }
      );
      setWishlist(next);
      toast('Removed from wishlist', 'info');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        toast(err.message, 'error');
      } else {
        toast('Could not remove item. Please try again.', 'error');
      }
    } finally {
      setRemovingId(null);
    }
  }

  if (wishlist.items.length === 0) {
    return (
      <div className="card p-8 text-center sm:p-12">
        <p className="eyebrow">Wishlist</p>
        <h2 className="mt-2 font-display text-xl font-bold text-ink-900">
          Your wishlist is empty
        </h2>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-500">
          Save items you are interested in while browsing the store. Your saved list is preserved
          across visits and merges automatically when you sign in.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/shop" className="btn-primary">
            Explore products
          </Link>
          {!isLoggedIn && (
            <Link href="/auth/login?next=/wishlist" className="btn-secondary">
              Sign in to sync wishlist
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!isLoggedIn && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-500/20 bg-brand-50/60 px-4 py-3 text-xs text-ink-700">
          <span>
            You are viewing a guest wishlist. Sign in or create an account to keep these items
            across all your devices.
          </span>
          <Link href="/auth/login?next=/wishlist" className="font-semibold text-brand-700 underline">
            Sign in
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {wishlist.items.map((item) => {
          const p = item.product;
          if (!p) {
            return (
              <article
                key={item.productId}
                className="card flex flex-col justify-between border-dashed border-ink-900/15 bg-cream-50/60 p-5"
              >
                <div>
                  <Badge tone="neutral">Unavailable</Badge>
                  <h3 className="mt-2 font-medium text-ink-700">{item.unavailableName}</h3>
                  <p className="mt-1 text-xs text-ink-500">
                    {item.unavailableReason ??
                      'This product is no longer available in the catalog.'}
                  </p>
                </div>
                <div className="mt-4 flex justify-end border-t border-ink-900/10 pt-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    loading={removingId === item.productId}
                    onClick={() => removeItem(item.productId)}
                  >
                    Remove
                  </Button>
                </div>
              </article>
            );
          }

          const avail = p.availability;
          return (
            <article key={item.productId} className="card flex flex-col overflow-hidden">
              <Link
                href={`/products/${p.slug}`}
                className="relative aspect-square overflow-hidden bg-cream-100"
              >
                {p.imageUrls[0] ? (
                  <Image
                    src={p.imageUrls[0]}
                    alt={p.imageAlt || p.name}
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-ink-400">
                    No image
                  </div>
                )}
                <div className="absolute left-2.5 top-2.5">
                  <Badge
                    tone={
                      avail.state === 'IN_STOCK'
                        ? 'green'
                        : avail.state === 'LOW_STOCK'
                          ? 'amber'
                          : avail.state === 'OUT_OF_STOCK'
                            ? 'red'
                            : 'neutral'
                    }
                  >
                    {avail.label || 'In stock'}
                  </Badge>
                </div>
              </Link>

              <div className="flex flex-1 flex-col p-4">
                {p.categoryName && (
                  <p className="text-[11px] font-medium uppercase tracking-wider text-ink-400">
                    {p.categoryName}
                  </p>
                )}
                <Link
                  href={`/products/${p.slug}`}
                  className="mt-1 line-clamp-2 text-sm font-medium text-ink-900 hover:text-brand-700"
                >
                  {p.name}
                </Link>
                <p className="mt-2 font-display text-base font-bold tabular-nums text-ink-900">
                  {p.hasVariants ? 'From ' : ''}
                  {formatINR(p.pricePaise)}
                </p>

                <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                  {p.hasVariants ? (
                    <Link
                      href={`/products/${p.slug}`}
                      className="rounded-xl border border-ink-900/15 bg-white px-3 py-1.5 text-xs font-semibold text-ink-800 hover:bg-cream-50"
                    >
                      Select options
                    </Link>
                  ) : (
                    <AddToCartButton
                      productId={p.id}
                      compact
                      disabled={!avail.purchasable}
                      disabledLabel={avail.label || 'Sold out'}
                    />
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    loading={removingId === item.productId}
                    onClick={() => removeItem(item.productId)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
