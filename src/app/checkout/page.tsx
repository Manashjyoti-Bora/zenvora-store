import type { Metadata } from 'next';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth/guards';
import { getCartViewReadOnly } from '@/lib/cart/service';
import { getSettings } from '@/lib/settings';
import { describePaymentProvider } from '@/lib/payments';
import { prisma } from '@/lib/db';
import { CheckoutForm } from '@/components/checkout/checkout-form';
import { EmptyState } from '@/components/ui/feedback';
import { LinkButton } from '@/components/ui/button';
import { CartIcon } from '@/components/ui/icons';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false },
};

export default async function CheckoutPage() {
  const user = await getCurrentUser();
  const [cart, settings, payments, addresses, profile] = await Promise.all([
    getCartViewReadOnly(user?.id ?? null),
    getSettings(),
    Promise.resolve(describePaymentProvider()),
    user
      ? prisma.address.findMany({
          where: { userId: user.id },
          orderBy: [{ isDefaultShipping: 'desc' }, { createdAt: 'desc' }],
          take: 5,
        })
      : Promise.resolve([]),
    user
      ? prisma.user.findUnique({ where: { id: user.id }, select: { phone: true } })
      : Promise.resolve(null),
  ]);

  if (cart.isEmpty) {
    return (
      <div className="container-store py-16">
        <h1 className="mb-6">Checkout</h1>
        <EmptyState
          icon={<CartIcon className="h-6 w-6" />}
          title="Your cart is empty"
          description="Add products to your cart before checking out."
          action={<LinkButton href="/shop">Browse products</LinkButton>}
        />
      </div>
    );
  }

  const gatewayAvailable = payments.kind !== 'NONE';

  return (
    <div className="container-store py-6 sm:py-8">
      <header className="mb-6">
        <h1>Checkout</h1>
        <p className="mt-1 text-sm text-ink-400">
          Review your details below. Prices are final and include applicable taxes.
          {user ? (
            <>
              {' '}
              Logged in as <span className="font-medium text-ink-700">{user.email}</span> —{' '}
              <Link href="/account" className="link-primary">
                manage account
              </Link>
            </>
          ) : (
            <>
              {' '}
              Checking out as guest —{' '}
              <Link href="/auth/login?next=/checkout" className="link-primary">
                log in
              </Link>{' '}
              for saved addresses.
            </>
          )}
        </p>
      </header>

      <CheckoutForm
        cart={cart}
        isLoggedIn={Boolean(user)}
        userName={user?.name ?? ''}
        userEmail={user?.email ?? ''}
        userPhone={profile?.phone ?? ''}
        addresses={addresses.map((a) => ({
          id: a.id,
          label: a.label,
          fullName: a.fullName,
          phone: a.phone,
          line1: a.line1,
          line2: a.line2,
          city: a.city,
          state: a.state,
          postalCode: a.postalCode,
          country: a.country,
          isDefaultShipping: a.isDefaultShipping,
        }))}
        settings={{
          storeName: settings.storeName,
          codEnabled: settings.shipping.codEnabled,
          codFeePaise: settings.shipping.codFeePaise,
          flatShippingPaise: settings.shipping.flatRatePaise,
          freeShippingAbovePaise: settings.shipping.freeAbovePaise,
          estimatedDaysMin: settings.shipping.estimatedDaysMin,
          estimatedDaysMax: settings.shipping.estimatedDaysMax,
          returnWindowDays: settings.policies.returnWindowDays,
        }}
        payments={{
          gatewayAvailable,
          gatewayIsTest: payments.isTest,
          gatewayLabel: payments.label,
        }}
      />
    </div>
  );
}
