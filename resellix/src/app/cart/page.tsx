import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth/guards';
import { getCartViewReadOnly } from '@/lib/cart/service';
import { CartManager } from '@/components/store/cart-manager';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your cart',
  alternates: { canonical: '/cart' },
  robots: { index: false },
};

export default async function CartPage() {
  const user = await getCurrentUser();
  const cart = await getCartViewReadOnly(user?.id ?? null);

  return (
    <div className="container-store py-6 sm:py-8">
      <header className="mb-6">
        <h1>Your cart</h1>
      </header>
      <CartManager initialCart={cart} isLoggedIn={Boolean(user)} />
    </div>
  );
}
