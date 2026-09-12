import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { getSettings } from '@/lib/settings';

/* Title/description/OG inherit the root layout defaults; the homepage only
   needs its self-referencing canonical (every other indexable route already
   declares one; utility/PII routes are noindex). */
export const metadata: Metadata = {
  alternates: { canonical: '/' },
};
import {
  getFeaturedProducts,
  getNewArrivals,
  getSaleProducts,
  listActiveCategories,
} from '@/lib/catalog/storefront';
import { prisma } from '@/lib/db';
import { describePaymentProvider } from '@/lib/payments';
import { ProductGrid } from '@/components/store/product-grid';
import { LinkButton } from '@/components/ui/button';
import { formatINR } from '@/lib/money';
import { DemoExplainer } from '@/components/store/demo-explainer';
import { Reveal } from '@/components/store/reveal';
import { HeroPanel } from '@/components/store/hero-panel';

export const dynamic = 'force-dynamic';

/* Inline icon set — drawn for Zenvora, no emoji, no icon dependency. */
function TruckIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2 6.5A1.5 1.5 0 0 1 3.5 5h9A1.5 1.5 0 0 1 14 6.5V15H2V6.5Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 8.5h3.9c.5 0 .96.25 1.23.67l2.3 3.5c.17.26.27.57.27.88V15h-7.7" />
      <circle cx="6.5" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  );
}
function LockIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <rect x="5" y="10.5" width="14" height="9" rx="2" />
      <path strokeLinecap="round" d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
      <circle cx="12" cy="15" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
function ReturnIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 9h11a5 5 0 0 1 0 10h-4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 5.5 4 9l3.5 3.5" />
    </svg>
  );
}
function ArrowIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}

function SectionHeader({
  id,
  eyebrow,
  title,
  href,
  linkLabel,
}: {
  id: string;
  eyebrow: string;
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={id} className="mt-1">
          {title}
        </h2>
      </div>
      {href && linkLabel && (
        <Link
          href={href}
          className="btn-press group inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink-900/10 bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-hair hover:border-brand-300 hover:text-brand-800"
        >
          {linkLabel}
          <span className="sr-only"> {title}</span>
          <ArrowIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}

export default async function HomePage() {
  const [settings, categories, featured, newest, deals, activeCount, payments] = await Promise.all([
    getSettings(),
    listActiveCategories(),
    getFeaturedProducts(8),
    getNewArrivals(8),
    getSaleProducts(8),
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
  const heroProduct = featured.find((p) => p.imageUrls.length > 0) ?? null;

  return (
    <>
      {/* ============ Hero — layered ink surface, real data only ============ */}
      <section className="relative overflow-hidden bg-ink-950 text-cream-50">
        {/* Brand depth: two soft radial washes, pure CSS, no images. */}
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
          style={{
            background:
              'radial-gradient(52rem 28rem at 88% -10%, rgba(53, 136, 93, 0.28), transparent 62%), radial-gradient(36rem 22rem at -8% 108%, rgba(198, 167, 92, 0.14), transparent 60%)',
          }}
        />
        {/* Film grain: kills the "flat CSS gradient" look. Static, zero-cost. */}
        <div className="grain" aria-hidden="true" />
        <div className="container-store relative py-14 sm:py-20 lg:py-24">
          <div className="grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-14">
            <div className="animate-fade-up">
              <p className="eyebrow text-brass-300">
                {settings.storeName}
                {activeCount > 0 ? ` · ${activeCount} product${activeCount === 1 ? '' : 's'} live` : ''}
              </p>
              <h1 className="display mt-3 text-4xl leading-[1.05] text-cream-50 sm:text-5xl lg:text-[3.4rem]">
                {settings.storeTagline || 'Quality products, delivered across India'}
              </h1>
              <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-cream-100/75 sm:text-base">
                Transparent pricing in ₹, secure payments, and honest order tracking — from
                checkout to your doorstep. Every price you see is final and tax-inclusive.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <LinkButton href="/shop" size="lg">
                  Shop now
                </LinkButton>
                <Link
                  href="/track"
                  className="btn-press inline-flex items-center justify-center rounded-lg border border-cream-100/25 px-5 py-2.5 text-sm font-semibold text-cream-50 hover:border-brass-300/60 hover:bg-white/5"
                >
                  Track an order
                </Link>
              </div>
              {/* Trust row — every claim is read from real settings/provider state. */}
              <ul className="mt-10 grid grid-cols-1 gap-x-6 gap-y-3 text-[13px] text-cream-100/80 sm:grid-cols-3">
                <li className="flex items-center gap-2.5">
                  <TruckIcon className="h-5 w-5 shrink-0 text-brass-300" />
                  {settings.shipping.freeAbovePaise > 0
                    ? `Free shipping above ${formatINR(settings.shipping.freeAbovePaise)}`
                    : 'Pan-India shipping'}
                </li>
                <li className="flex items-center gap-2.5">
                  <LockIcon className="h-5 w-5 shrink-0 text-brass-300" />
                  <span>
                    Secure payments {onlineLabel}
                    {codLabel}
                  </span>
                </li>
                <li className="flex items-center gap-2.5">
                  <ReturnIcon className="h-5 w-5 shrink-0 text-brass-300" />
                  {settings.policies.returnWindowDays > 0
                    ? `${settings.policies.returnWindowDays}-day returns`
                    : 'See returns policy'}
                </li>
              </ul>
            </div>

            {/* Right composition: the real top-featured product, or an honest
                brand panel when no product imagery exists yet. HeroPanel adds
                the signature scroll drift on capable desktop pointers only. */}
            <div className="animate-fade-up lg:justify-self-end" style={{ animationDelay: '120ms' }}>
              <HeroPanel>
              {heroProduct ? (
                <Link
                  href={`/products/${heroProduct.slug}`}
                  className="group relative block w-full max-w-sm rounded-2xl bg-white p-3 shadow-glow transition-transform duration-300 ease-zenvora [@media(hover:hover)]:hover:-translate-y-1"
                >
                  <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-cream-100">
                    <Image
                      src={heroProduct.imageUrls[0]}
                      alt={heroProduct.imageAlt || heroProduct.name}
                      fill
                      sizes="(max-width: 1024px) 80vw, 380px"
                      className="object-cover transition-transform duration-500 ease-zenvora [@media(hover:hover)]:group-hover:scale-[1.04]"
                      priority
                    />
                    {heroProduct.compareAtPricePaise != null &&
                      heroProduct.compareAtPricePaise > heroProduct.pricePaise && (
                        <span className="absolute left-3 top-3 rounded-full bg-accent-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-soft">
                          On sale
                        </span>
                      )}
                  </div>
                  <div className="flex items-end justify-between gap-3 px-1.5 pb-1 pt-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink-900">{heroProduct.name}</p>
                      <p className="mt-0.5 text-xs text-ink-400">
                        {heroProduct.categoryName ?? 'Featured'}
                      </p>
                    </div>
                    <p className="shrink-0 text-base font-bold tabular-nums text-ink-900">
                      {formatINR(heroProduct.pricePaise)}
                    </p>
                  </div>
                </Link>
              ) : (
                <div className="relative w-full max-w-sm rounded-2xl border border-cream-100/15 bg-white/[0.04] p-8 backdrop-blur-sm">
                  <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-brand-600 text-2xl font-black text-white shadow-glow">
                    {settings.storeName.slice(0, 1).toUpperCase()}
                  </span>
                  <p className="display mt-6 text-xl text-cream-50">{settings.storeName}</p>
                  <p className="mt-2 text-sm leading-relaxed text-cream-100/70">
                    {categories.length > 0
                      ? `${categories.length} categor${categories.length === 1 ? 'y' : 'ies'} ready to explore`
                      : 'Our catalog is being curated'}
                    {activeCount > 0 ? ` · ${activeCount} product${activeCount === 1 ? '' : 's'} live` : ''}.
                  </p>
                </div>
              )}
              </HeroPanel>
            </div>
          </div>
        </div>
        {/* Hairline base for a clean surface handoff */}
        <div className="h-px w-full bg-gradient-to-r from-transparent via-brass-300/40 to-transparent" aria-hidden="true" />
      </section>

      {settings.demoMode && (
        <section className="container-store pt-8" id="demo-mode">
          <DemoExplainer />
        </section>
      )}

      {/* ============ Categories — snap rail on mobile, grid on desktop ====== */}
      {categories.length > 0 && (
        <section className="container-store py-10 sm:py-12" aria-labelledby="shop-by-category">
          <SectionHeader id="shop-by-category" eyebrow="Browse" title="Shop by category" href="/shop" linkLabel="View all" />
          <div className="-mx-4 px-4 sm:mx-0 sm:px-0">
            <div className="snap-rail sm:grid sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
              {categories.slice(0, 8).map((c) => (
                <Link
                  key={c.id}
                  href={`/categories/${c.slug}`}
                  className="card card-hover btn-press group flex w-40 shrink-0 snap-start flex-col gap-3 p-4 sm:w-auto sm:shrink"
                >
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-base font-bold text-brand-700 ring-1 ring-brand-100 transition-colors group-hover:bg-brand-100"
                    aria-hidden="true"
                  >
                    {c.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink-900 group-hover:text-brand-700">
                      {c.name}
                    </span>
                    <span className="mt-0.5 block text-xs tabular-nums text-ink-400">
                      {c.productCount} product{c.productCount === 1 ? '' : 's'}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============ Deals — rendered ONLY when real discounts exist ======== */}
      {deals.length > 0 && (
        <section className="border-y border-ink-900/5 bg-white py-10 sm:py-12" aria-labelledby="deals">
          <div className="container-store">
            <Reveal>
              <SectionHeader id="deals" eyebrow="Limited pricing" title="Deals right now" href="/shop?sort=price-asc" linkLabel="Shop all" />
              <ProductGrid products={deals} />
            </Reveal>
          </div>
        </section>
      )}

      {/* ============ Featured ============================================= */}
      {featured.length > 0 && (
        <section className="container-store py-10 sm:py-12" aria-labelledby="featured-products">
          <Reveal>
            <SectionHeader id="featured-products" eyebrow="Hand-picked" title="Featured products" href="/shop?sort=featured" linkLabel="See more" />
            <ProductGrid products={featured} />
          </Reveal>
        </section>
      )}

      {/* ============ New arrivals ========================================== */}
      {newest.length > 0 && (
        <section className="container-store pb-14 pt-2 sm:pb-16" aria-labelledby="new-arrivals">
          <Reveal delay={60}>
            <SectionHeader id="new-arrivals" eyebrow="Just in" title="New arrivals" href="/shop?sort=newest" linkLabel="See more" />
            <ProductGrid products={newest} />
          </Reveal>
        </section>
      )}

      {/* Empty catalog state — honest, never fake products */}
      {activeCount === 0 && (
        <section className="container-store py-16 text-center">
          <h2 className="text-lg font-semibold text-ink-900">The catalog is being set up</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-500">
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

      {/* ============ How ordering works ==================================== */}
      <section className="border-t border-ink-900/5 bg-white" aria-labelledby="how-it-works">
        <div className="container-store py-12 sm:py-14">
          <p className="eyebrow text-center">Simple &amp; transparent</p>
          <h2 id="how-it-works" className="mt-1 text-center">
            How ordering works
          </h2>
          <ol className="mx-auto mt-9 grid max-w-4xl grid-cols-1 gap-6 sm:grid-cols-4">
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
              <li key={s.n} className="relative text-center">
                <span
                  className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-ink-950 text-sm font-bold text-brass-300 shadow-soft"
                  aria-hidden="true"
                >
                  {s.n}
                </span>
                <h3 className="mt-3.5 text-sm font-semibold text-ink-900">{s.t}</h3>
                <p className="mx-auto mt-1.5 max-w-56 text-xs leading-relaxed text-ink-500">{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
