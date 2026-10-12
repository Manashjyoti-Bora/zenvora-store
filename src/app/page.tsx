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
    <div className="mb-4 flex items-end justify-between gap-3 sm:mb-5 sm:gap-4">
      <div className="min-w-0">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={id} className="mt-1 truncate text-xl sm:text-2xl">
          {title}
        </h2>
      </div>
      {href && linkLabel && (
        <Link
          href={href}
          className="btn-press group inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink-900/10 bg-white px-3.5 py-1.5 text-xs font-semibold text-brand-700 shadow-hair hover:border-brand-300 hover:text-brand-800 sm:px-4 sm:py-2 sm:text-sm"
        >
          {linkLabel}
          <span className="sr-only"> {title}</span>
          <ArrowIcon className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5 sm:h-4 sm:w-4" />
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
      {/* ============ Hero — layered forest surface, real data only ============ */}
      <section className="relative overflow-hidden bg-brand-800 text-cream-50">
        {/* Brand depth: two soft radial washes, pure CSS, no images. */}
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
          style={{
            background:
              'radial-gradient(52rem 28rem at 88% -10%, rgba(23, 75, 58, 0.35), transparent 62%), radial-gradient(36rem 22rem at -8% 108%, rgba(198, 166, 107, 0.12), transparent 60%)',
          }}
        />
        {/* Film grain: kills the "flat CSS gradient" look. Static, zero-cost. */}
        <div className="grain" aria-hidden="true" />
        <div className="container-store relative py-9 sm:py-16 lg:py-22">
          <div className="grid items-center gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-14">
            <div className="animate-fade-up">
              <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-accent-300/25 bg-white/[0.04] px-3 py-1 backdrop-blur-sm">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    activeCount > 0 ? 'bg-emerald-400' : 'bg-accent-300'
                  }`}
                  aria-hidden="true"
                />
                <p className="eyebrow truncate text-[10px] text-accent-300 sm:text-[11px]">
                  {settings.storeName}
                  {activeCount > 0
                    ? ` · ${activeCount} product${activeCount === 1 ? '' : 's'} live`
                    : ' · Direct-to-doorstep commerce'}
                </p>
              </div>

              <h1 className="display mt-3.5 text-[1.85rem] leading-[1.08] text-cream-50 sm:mt-4 sm:text-5xl lg:text-[3.35rem]" style={{ letterSpacing: '-0.028em' }}>
                {settings.storeTagline || 'Quality products, delivered across India'}
              </h1>
              <p className="mt-3.5 max-w-xl text-sm leading-relaxed text-cream-100/80 sm:mt-5 sm:text-base">
                Transparent pricing in ₹, secure payments, and honest order tracking — from
                checkout to your doorstep. Every price you see is final and tax-inclusive.
              </p>

              <div className="mt-6 grid grid-cols-2 gap-2.5 sm:mt-8 sm:flex sm:flex-wrap sm:gap-3">
                <LinkButton href="/shop" size="lg" className="w-full justify-center sm:w-auto">
                  Shop now
                </LinkButton>
                <Link
                  href="/track"
                  className="btn-press inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border border-cream-100/25 bg-white/[0.03] px-4 py-2.5 text-sm font-semibold text-cream-50 transition-colors hover:border-accent-300/60 hover:bg-white/10 sm:w-auto sm:px-5"
                >
                  Track an order
                </Link>
              </div>

              {/* Trust row — every claim is read from real settings/provider state. */}
              <ul className="mt-7 grid grid-cols-1 gap-2 rounded-2xl border border-cream-100/10 bg-white/[0.03] p-3 text-xs text-cream-100/85 backdrop-blur-sm sm:mt-9 sm:grid-cols-3 sm:gap-3.5 sm:p-4 sm:text-[13px]">
                <li className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-300/15 text-accent-300">
                    <TruckIcon className="h-4 w-4 sm:h-5 sm:w-5" />
                  </span>
                  <span className="leading-snug">
                    {settings.shipping.freeAbovePaise > 0
                      ? `Free shipping above ${formatINR(settings.shipping.freeAbovePaise)}`
                      : 'Pan-India shipping'}
                  </span>
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-300/15 text-accent-300">
                    <LockIcon className="h-4 w-4 sm:h-5 sm:w-5" />
                  </span>
                  <span className="leading-snug">
                    Secure payments {onlineLabel}
                    {codLabel}
                  </span>
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-300/15 text-accent-300">
                    <ReturnIcon className="h-4 w-4 sm:h-5 sm:w-5" />
                  </span>
                  <span className="leading-snug">
                    {settings.policies.returnWindowDays > 0
                      ? `${settings.policies.returnWindowDays}-day returns`
                      : 'See returns policy'}
                  </span>
                </li>
              </ul>
            </div>

            {/* Right composition: the real top-featured product, or a verified
                storefront specification panel when no product imagery exists yet. */}
            <div className="animate-fade-up lg:justify-self-end" style={{ animationDelay: '120ms' }}>
              <HeroPanel>
                {heroProduct ? (
                  <Link
                    href={`/products/${heroProduct.slug}`}
                    className="group relative mx-auto block w-full max-w-sm rounded-2xl border border-cream-100/15 bg-white p-3 shadow-glow transition-transform duration-300 ease-zenvora [@media(hover:hover)]:hover:-translate-y-1"
                  >
                    <div className="mb-2.5 flex items-center justify-between px-1 text-[10px] font-bold uppercase tracking-wider text-ink-400">
                      <span>Featured selection</span>
                      <span className="text-brand-700">Tax-inclusive ₹</span>
                    </div>
                    <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-cream-100">
                      <Image
                        src={heroProduct.imageUrls[0]}
                        alt={heroProduct.imageAlt || heroProduct.name}
                        fill
                        sizes="(max-width: 1024px) 80vw, 380px"
                        className="object-cover transition-transform duration-500 ease-zenvora [@media(hover:hover)]:group-hover:scale-[1.04]"
                        priority
                      />
                      {/* "On sale" uses accent-700: 11px white text needs ≥4.5:1 contrast. */}
                      {heroProduct.compareAtPricePaise != null &&
                        heroProduct.compareAtPricePaise > heroProduct.pricePaise && (
                          <span className="absolute left-3 top-3 rounded-full bg-accent-700 px-2.5 py-1 text-[11px] font-bold text-white shadow-soft">
                            On sale
                          </span>
                        )}
                    </div>
                    <div className="flex items-end justify-between gap-3 px-1.5 pb-1 pt-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink-900">
                          {heroProduct.name}
                        </p>
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
                  <div className="relative mx-auto w-full max-w-md rounded-2xl border border-cream-100/15 bg-white/[0.04] p-4 backdrop-blur-sm sm:p-6">
                    <div className="flex items-center justify-between gap-3 border-b border-cream-100/10 pb-3.5">
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-base font-black text-white shadow-glow">
                          {settings.storeName.slice(0, 1).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-cream-50">
                            {settings.storeName}
                          </p>
                          <p className="text-[11px] text-accent-300">
                            Storefront Standards &amp; Terms
                          </p>
                        </div>
                      </div>
                      <span className="rounded-full border border-accent-300/30 bg-accent-300/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-300">
                        INR (₹)
                      </span>
                    </div>

                    <dl className="mt-3.5 grid grid-cols-2 gap-2.5 text-xs">
                      <div className="rounded-xl border border-cream-100/10 bg-white/[0.03] p-2.5">
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-cream-100/55">
                          Pricing
                        </dt>
                        <dd className="mt-1 font-semibold text-cream-50">
                          {settings.tax.pricesIncludeTax ? 'GST-inclusive ₹' : 'INR + GST at checkout'}
                        </dd>
                      </div>
                      <div className="rounded-xl border border-cream-100/10 bg-white/[0.03] p-2.5">
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-cream-100/55">
                          Dispatch ETA
                        </dt>
                        <dd className="mt-1 font-semibold tabular-nums text-cream-50">
                          {settings.shipping.estimatedDaysMin}–{settings.shipping.estimatedDaysMax} business days
                        </dd>
                      </div>
                      <div className="rounded-xl border border-cream-100/10 bg-white/[0.03] p-2.5">
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-cream-100/55">
                          Free shipping
                        </dt>
                        <dd className="mt-1 font-semibold tabular-nums text-cream-50">
                          {settings.shipping.freeAbovePaise > 0
                            ? `Orders above ${formatINR(settings.shipping.freeAbovePaise)}`
                            : 'Standard pan-India'}
                        </dd>
                      </div>
                      <div className="rounded-xl border border-cream-100/10 bg-white/[0.03] p-2.5">
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-cream-100/55">
                          Returns window
                        </dt>
                        <dd className="mt-1 font-semibold tabular-nums text-cream-50">
                          {settings.policies.returnWindowDays > 0
                            ? `${settings.policies.returnWindowDays} days from delivery`
                            : 'See returns policy'}
                        </dd>
                      </div>
                    </dl>
                  </div>
                )}
              </HeroPanel>
            </div>
          </div>
        </div>
        {/* Hairline base for a clean surface handoff */}
        <div className="h-px w-full bg-gradient-to-r from-transparent via-accent-300/40 to-transparent" aria-hidden="true" />
      </section>

      {settings.demoMode && (
        <section className="container-store pt-6 sm:pt-8" id="demo-mode">
          <DemoExplainer activeCount={activeCount} />
        </section>
      )}

      {/* ============ Categories — snap rail on mobile, grid on desktop ====== */}
      {categories.length > 0 && (
        <section className="container-store py-8 sm:py-12" aria-labelledby="shop-by-category">
          <SectionHeader id="shop-by-category" eyebrow="Browse" title="Shop by category" href="/shop" linkLabel="View all" />
          <div className="-mx-4 px-4 sm:mx-0 sm:px-0">
            <div className="snap-rail sm:grid sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
              {categories.slice(0, 8).map((c) => (
                <Link
                  key={c.id}
                  href={`/categories/${c.slug}`}
                  className="card card-hover btn-press group flex w-48 shrink-0 snap-start items-center gap-3 p-3.5 sm:w-auto sm:shrink sm:p-4"
                >
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-sm font-bold text-accent-300 ring-1 ring-accent-300/30 transition-colors group-hover:bg-brand-800 group-hover:text-white"
                    aria-hidden="true"
                  >
                    {c.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink-900 group-hover:text-brand-700">
                      {c.name}
                    </span>
                    <span className="mt-0.5 block text-xs tabular-nums text-ink-400">
                      {c.productCount} product{c.productCount === 1 ? '' : 's'}
                    </span>
                  </span>
                  <ArrowIcon className="h-4 w-4 shrink-0 text-ink-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-brand-700" />
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============ Deals — rendered ONLY when real discounts exist ======== */}
      {deals.length > 0 && (
        <section className="border-y border-ink-900/5 bg-white py-8 sm:py-12" aria-labelledby="deals">
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
        <section className="container-store py-8 sm:py-12" aria-labelledby="featured-products">
          <Reveal>
            <SectionHeader id="featured-products" eyebrow="Hand-picked" title="Featured products" href="/shop?sort=featured" linkLabel="See more" />
            <ProductGrid products={featured} />
          </Reveal>
        </section>
      )}

      {/* ============ New arrivals ========================================== */}
      {newest.length > 0 && (
        <section className="container-store pb-12 pt-2 sm:pb-16" aria-labelledby="new-arrivals">
          <Reveal delay={60}>
            <SectionHeader id="new-arrivals" eyebrow="Just in" title="New arrivals" href="/shop?sort=newest" linkLabel="See more" />
            <ProductGrid products={newest} />
          </Reveal>
        </section>
      )}

      {/* Empty catalog state — honest, never fake products, framed in Zenvora editorial card */}
      {activeCount === 0 && (
        <section className="container-store py-8 sm:py-12" aria-labelledby="catalog-setup-heading">
          <div className="card overflow-hidden border border-ink-900/10 bg-white p-5 shadow-soft sm:p-8">
            <div className="mx-auto max-w-2xl text-center">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-cream-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-ink-600 ring-1 ring-ink-900/10">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-400" aria-hidden="true" />
                Catalog Status · Pre-Launch
              </span>
              <h2 id="catalog-setup-heading" className="mt-3 text-xl font-bold text-ink-900 sm:text-2xl">
                The catalog is being set up
              </h2>
              <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-ink-500 sm:text-sm">
                Products will appear here as soon as the store owner publishes them. If you are the
                owner, log in to the admin panel to add products, sync your supplier catalog, or
                import a CSV.
              </p>

              <div className="mt-6 grid grid-cols-1 gap-2.5 text-left sm:grid-cols-3 sm:gap-3">
                <div className="rounded-xl border border-ink-900/8 bg-cream-50/70 p-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-brand-700">
                    Step 01 · Source
                  </p>
                  <p className="mt-1 text-xs font-semibold text-ink-900">Sync or import</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">
                    Sync CJ Dropshipping in Admin → Suppliers or upload a product CSV.
                  </p>
                </div>
                <div className="rounded-xl border border-ink-900/8 bg-cream-50/70 p-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-brand-700">
                    Step 02 · Price
                  </p>
                  <p className="mt-1 text-xs font-semibold text-ink-900">Map &amp; verify margin</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">
                    Link supplier SKUs to catalog products with automatic INR margin protection.
                  </p>
                </div>
                <div className="rounded-xl border border-ink-900/8 bg-cream-50/70 p-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-brand-700">
                    Step 03 · Publish
                  </p>
                  <p className="mt-1 text-xs font-semibold text-ink-900">Set status to ACTIVE</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">
                    Only products marked ACTIVE appear on the public storefront.
                  </p>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
                <LinkButton href="/auth/login" variant="primary" size="md">
                  Owner log in
                </LinkButton>
                <LinkButton href="/admin/products" variant="outline" size="md">
                  Open Admin Catalog
                </LinkButton>
                <LinkButton href="/track" variant="ghost" size="md">
                  Track existing order
                </LinkButton>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ============ How ordering works ==================================== */}
      <section className="border-t border-ink-900/5 bg-white" aria-labelledby="how-it-works">
        <div className="container-store py-10 sm:py-14">
          <p className="eyebrow text-center">Simple &amp; transparent</p>
          <h2 id="how-it-works" className="mt-1 text-center text-xl sm:text-2xl">
            How ordering works
          </h2>
          <ol className="mx-auto mt-6 grid max-w-5xl grid-cols-1 gap-3 sm:mt-9 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            {[
              {
                n: '01',
                t: 'Browse & add to cart',
                d: 'Prices shown in ₹ are final, tax-inclusive prices.',
              },
              {
                n: '02',
                t: 'Secure checkout',
                d: 'Pay online via our payment gateway or choose Cash on Delivery where available.',
              },
              {
                n: '03',
                t: 'We prepare your order',
                d: 'Your order is confirmed and dispatched through our fulfilment partners.',
              },
              {
                n: '04',
                t: 'Track to your door',
                d: 'Follow live shipping status with your order number and email.',
              },
            ].map((s) => (
              <li
                key={s.n}
                className="card relative flex items-start gap-3.5 p-4 text-left sm:flex-col sm:gap-0 sm:p-5"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-xs font-bold text-accent-300 shadow-soft sm:h-10 sm:w-10"
                  aria-hidden="true"
                >
                  {s.n}
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-ink-900 sm:mt-4">{s.t}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-ink-500 sm:mt-1.5">{s.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
