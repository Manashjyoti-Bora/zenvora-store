import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth/guards';
import { getWishlistViewReadOnly } from '@/lib/wishlist/service';
import { WishlistManager } from '@/components/store/wishlist-manager';
import { Breadcrumbs } from '@/components/store/breadcrumbs';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your Wishlist',
  description: 'Saved products in your wishlist.',
  // No canonical: a canonical URL on a noindex page is a conflicting signal.
  robots: { index: false },
};

export default async function WishlistPage() {
  const user = await getCurrentUser();
  const wishlist = await getWishlistViewReadOnly(user?.id ?? null);

  return (
    <div className="container-store py-6 sm:py-8">
      <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Wishlist' }]} />
      <header className="mb-6 rounded-2xl border border-ink-900/10 bg-gradient-to-br from-cream-100/80 via-white to-cream-50 p-5 shadow-hair sm:p-6">
        <p className="eyebrow">Saved Items</p>
        <h1 className="display mt-1.5">Your Wishlist</h1>
        <p className="mt-1 text-sm tabular-nums text-ink-500">
          {wishlist.count} saved item{wishlist.count === 1 ? '' : 's'}
        </p>
      </header>
      <WishlistManager initialWishlist={wishlist} isLoggedIn={Boolean(user)} />
    </div>
  );
}
