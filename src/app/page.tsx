import Link from 'next/link';
import { getSettings } from '@/lib/settings';
import {
  getFeaturedProducts,
  getNewArrivals,
  listActiveCategories,
} from '@/lib/catalog/storefront';
import { prisma } from '@/lib/db';
import { describePaymentProvider } from '@/lib/payments';
import { ProductGrid } from '@/components/store/product-grid';
import { LinkButton } from '@/components/ui/button';
import { formatINR } from '@/lib/money';
import { DemoExplainer } from '@/components/store/demo-explainer';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [settings, categories, featured, newest, activeCount, payments] = await Promise.all([
    getSettings(),
    listActiveCategories(),
    getFeaturedProducts(8),
    getNewArrivals(8),
    prisma.product.count({ where: { status: 'ACTIVE' } }),
    Promise.resolve(describePaymentProvider()),
  ]);

  const onlineLabel =
    payments.kind === 'RAZORPAY'
      ? 'via Razorpay'
      : payments.kind === 'TEST'
        ? '(TEST mode — no real money moves)'
        : '(being configured)';
  const codLabel = settings.shipping.codEnabled ? ' + Cash on Delivery' : '';

  return (
    <>
      {/* Hero */}
      <section className="border-b border-gray-200 bg-gradient-to-b from-brand-50 to-white">
        <div className="container-store py-12 sm:py-16 lg:py-20">
          <div className="max-w-2xl">
            <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl lg:text-5xl">
              {settings.storeTagline || `Quality products, delivered across India`}
            </h1>
            <p className="mt-4 text-base leading-relaxed text-gray-600 sm:text-lg">
              Shop{' '}
              {activeCount > 0
                ? `${activeCount} carefully listed product${activeCount === 1 ? '' : 's'}`
                : 'our catalog'}{' '}
              with transparent pricing in ₹, secure payments, and order tracking from checkout to
              your doorstep.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <LinkButton href="/shop" size="lg">
                Shop now
              </LinkButton>
              <LinkButton href="/track" size="lg" variant="outline">
                Track an order
              </LinkButton>
            </div>
            <ul className="mt-8 grid grid-cols-1 gap-3 text-sm text-gray-600 sm:grid-cols-3">
              <li className="flex items-center gap-2">
                <span aria-hidden="true">🚚</span>
                {settings.shipping.freeAbovePaise > 0
                  ? `Free shipping above ${formatINR(settings.shipping.freeAbovePaise)}`
                  : 'Pan-India shipping'}
              </li>
              <li className="flex items-center gap-2">
                <span aria-hidden="true">🔒</span> Secure online payments {onlineLabel}
                {codLabel}
              </li>
              <li className="flex items-center gap-2">
                <span aria-hidden="true">↩️</span>{' '}
                {settings.policies.returnWindowDays > 0
                  ? `${settings.policies.returnWindowDays}-day returns`
                  : 'See returns policy'}
              </li>
            </ul>
          </div>
        </div>
      </section>

      {settings.demoMode && (
        <section className="container-store pt-8" id="demo-mode">
          <DemoExplainer />
        </section>
      )}

      {/* Categories */}
      {categories.length > 0 && (
        <section className="container-store py-10" aria-labelledby="shop-by-category">
          <div className="mb-4 flex items-end justify-between gap-4">
            <h2 id="shop-by-category">Shop by category</h2>
            <Link href="/shop" className="text-sm font-medium text-brand-700 hover:text-brand-800">
              View all →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {categories.slice(0, 8).map((c) => (
              <Link
                key={c.id}
                href={`/categories/${c.slug}`}
                className="card group flex flex-col justify-between gap-2 p-4 transition-shadow hover:shadow-md"
              >
                <div>
                  <p className="font-semibold text-gray-900 group-hover:text-brand-700">{c.name}</p>
                  {c.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-gray-500">{c.description}</p>
                  )}
                </div>
                <p className="text-xs tabular-nums text-gray-400">
                  {c.productCount} product{c.productCount === 1 ? '' : 's'}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Featured */}
      {featured.length > 0 && (
        <section className="container-store py-6" aria-labelledby="featured-products">
          <div className="mb-4 flex items-end justify-between gap-4">
            <h2 id="featured-products">Featured products</h2>
            <Link
              href="/shop?sort=featured"
              className="text-sm font-medium text-brand-700 hover:text-brand-800"
            >
              See more →
            </Link>
          </div>
          <ProductGrid products={featured} />
        </section>
      )}

      {/* New arrivals */}
      {newest.length > 0 && (
        <section className="container-store py-6 pb-12" aria-labelledby="new-arrivals">
          <div className="mb-4 flex items-end justify-between gap-4">
            <h2 id="new-arrivals">New arrivals</h2>
            <Link
              href="/shop?sort=newest"
              className="text-sm font-medium text-brand-700 hover:text-brand-800"
            >
              See more →
            </Link>
          </div>
          <ProductGrid products={newest} />
        </section>
      )}

      {/* Empty catalog state - honest, never fake products */}
      {activeCount === 0 && (
        <section className="container-store py-16 text-center">
          <h2 className="text-lg font-semibold text-gray-900">The catalog is being set up</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
            Products will appear here as soon as the store owner publishes them. If you are the
            owner, log in to the admin panel to add products or import a CSV.
          </p>
          <div className="mt-4">
            <LinkButton href="/auth/login" variant="outline">
              Owner log in
            </LinkButton>
          </div>
        </section>
      )}

      {/* How ordering works */}
      <section className="border-t border-gray-200 bg-white" aria-labelledby="how-it-works">
        <div className="container-store py-12">
          <h2 id="how-it-works" className="text-center">
            How ordering works
          </h2>
          <ol className="mx-auto mt-8 grid max-w-4xl grid-cols-1 gap-6 sm:grid-cols-4">
            {[
              {
                n: '1',
                t: 'Browse & add to cart',
                d: 'Prices shown in ₹ are final, tax-inclusive prices.',
              },
              {
                n: '2',
                t: 'Secure checkout',
                d: 'Pay online via our payment gateway or choose Cash on Delivery where available.',
              },
              {
                n: '3',
                t: 'We prepare your order',
                d: 'Your order is confirmed and dispatched through our fulfilment partners.',
              },
              {
                n: '4',
                t: 'Track to your door',
                d: 'Follow live shipping status with your order number and email.',
              },
            ].map((s) => (
              <li key={s.n} className="text-center">
                <span
                  className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800"
                  aria-hidden="true"
                >
                  {s.n}
                </span>
                <h3 className="mt-3 text-sm font-semibold text-gray-900">{s.t}</h3>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
