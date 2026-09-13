import Link from 'next/link';
import { getSettings } from '@/lib/settings';
import { listActiveCategories } from '@/lib/catalog/storefront';

export async function Footer() {
  const settings = await getSettings();
  const categories = (await listActiveCategories()).slice(0, 6);
  const year = new Date().getFullYear();

  return (
    <footer className="relative mt-auto overflow-hidden bg-ink-950 text-cream-300">
      <div className="grain" aria-hidden="true" />
      <div className="container-store py-12 sm:py-14">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-4 lg:grid-cols-5">
          <div className="col-span-2 lg:col-span-2">
            <Link href="/" className="group inline-flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-sm font-black text-white transition-transform duration-200 group-hover:-rotate-6">
                Z
              </span>
              <span className="text-lg font-extrabold uppercase tracking-[0.18em] text-cream-100">
                {settings.storeName}
              </span>
            </Link>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-cream-400">
              {settings.storeTagline || 'Carefully sourced products, transparent pricing, dependable delivery.'}
            </p>
            {settings.supportEmail && (
              <a
                href={`mailto:${settings.supportEmail}`}
                className="mt-5 inline-flex items-center gap-2 rounded-lg border border-white/15 px-3.5 py-2 text-sm font-medium text-cream-200 transition-colors hover:border-brass-300/50 hover:text-white"
              >
                <svg className="h-4 w-4 text-brass-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
                  <rect x="3" y="5.5" width="18" height="13" rx="2" />
                  <path d="m3.5 7 8.5 6 8.5-6" />
                </svg>
                {settings.supportEmail}
              </a>
            )}
          </div>

          <nav aria-label="Shop">
            <h3 className="eyebrow text-brass-200">Shop</h3>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link href="/shop" className="transition-colors hover:text-white">
                  All products
                </Link>
              </li>
              <li>
                <Link href="/shop?sort=newest" className="transition-colors hover:text-white">
                  New arrivals
                </Link>
              </li>
              <li>
                <Link href="/track" className="transition-colors hover:text-white">
                  Track your order
                </Link>
              </li>
              <li>
                <Link href="/cart" className="transition-colors hover:text-white">
                  Cart
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-label="Product categories">
            <h3 className="eyebrow text-brass-200">Categories</h3>
            {categories.length > 0 ? (
              <ul className="mt-3 space-y-2 text-sm">
                {categories.map((category) => (
                  <li key={category.id}>
                    <Link
                      href={`/categories/${category.slug}`}
                      className="transition-colors hover:text-white"
                    >
                      {category.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-cream-500">
                Categories appear once products are added.{' '}
                <Link href="/shop" className="link-primary">
                  Browse all products
                </Link>
                .
              </p>
            )}
          </nav>

          <nav aria-label="Help">
            <h3 className="eyebrow text-brass-200">Help</h3>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link href="/faq" className="transition-colors hover:text-white">
                  FAQ
                </Link>
              </li>
              <li>
                <Link href="/contact" className="transition-colors hover:text-white">
                  Contact us
                </Link>
              </li>
              <li>
                <Link href="/policies/shipping" className="transition-colors hover:text-white">
                  Shipping policy
                </Link>
              </li>
              <li>
                <Link href="/policies/returns" className="transition-colors hover:text-white">
                  Returns &amp; refunds
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-label="Legal and account" className="col-span-2 md:col-span-1">
            <h3 className="eyebrow text-brass-200">Legal &amp; account</h3>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link href="/policies/privacy" className="transition-colors hover:text-white">
                  Privacy policy
                </Link>
              </li>
              <li>
                <Link href="/policies/terms" className="transition-colors hover:text-white">
                  Terms &amp; conditions
                </Link>
              </li>
              <li>
                <Link href="/auth/login" className="transition-colors hover:text-white">
                  Log in
                </Link>
              </li>
              <li>
                <Link href="/auth/register" className="transition-colors hover:text-white">
                  Create account
                </Link>
              </li>
            </ul>
            {settings.supportPhone && (
              <div className="mt-4 text-xs text-cream-500">
                <p>Phone: {settings.supportPhone}</p>
              </div>
            )}
          </nav>
        </div>
      </div>

      <div className="border-t border-white/10 py-5">
        <div className="container-store flex flex-col items-center justify-between gap-2 text-xs text-cream-500 sm:flex-row">
          <p>
            © {year} {settings.storeName}. All rights reserved.
          </p>
          <p>Prices in INR (₹), inclusive of applicable taxes where configured.</p>
        </div>
      </div>
    </footer>
  );
}
