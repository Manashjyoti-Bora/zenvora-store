import Link from 'next/link';
import { headers } from 'next/headers';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth/guards';
import { getCartItemCount } from '@/lib/cart/service';
import { getSettings } from '@/lib/settings';
import { MobileMenu } from './mobile-menu';
import { AccountMenu } from './account-menu';
import { SearchForm } from './search-form';

export async function Header() {
  const user = await getCurrentUser();
  // Server-side active-section state via the middleware's x-pathname header:
  // brass underline + aria-current, zero client JS (design language §10).
  const pathname = (await headers()).get('x-pathname') ?? '';
  const under = (active: boolean) =>
    active
      ? 'relative font-semibold text-ink-900 after:absolute after:-bottom-1.5 after:left-0 after:h-[2px] after:w-full after:rounded-full after:bg-brass-300'
      : '';
  const isShop = pathname === '/shop' || pathname.startsWith('/shop/');
  const isTrack = pathname === '/track' || pathname.startsWith('/track/');
  const catActive = (slug: string) =>
    pathname === `/categories/${slug}` || pathname.startsWith(`/categories/${slug}/`);
  const [cartCount, settings, categories] = await Promise.all([
    getCartItemCount(user?.id ?? null),
    getSettings(),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take: 7,
      select: { name: true, slug: true },
    }),
  ]);

  return (
    <header className="sticky top-0 z-40 border-b border-ink-900/10 bg-cream-50/95 shadow-hair backdrop-blur">
      <div className="container-store">
        <div className="flex h-14 items-center gap-3">
          <MobileMenu categories={categories} user={user} />

          <Link
            href="/"
            className="group flex shrink-0 items-center gap-2"
            aria-label={`${settings.storeName} home`}
          >
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-black text-white transition-transform duration-200 ease-zenvora [@media(hover:hover)]:group-hover:-rotate-6"
            >
              {settings.storeName.slice(0, 1).toUpperCase()}
            </span>
            <span className="hidden text-base font-extrabold uppercase tracking-[0.18em] text-ink-900 sm:block">
              {settings.storeName}
            </span>
          </Link>

          <nav aria-label="Main navigation" className="hidden flex-1 items-center gap-5 lg:flex">
            <Link
              href="/shop"
              aria-current={isShop ? 'page' : undefined}
              className={`text-sm font-semibold text-ink-800 transition-colors hover:text-brand-700 ${under(isShop)}`}
            >
              Shop
            </Link>
            {categories.slice(0, 5).map((c) => (
              <Link
                key={c.slug}
                href={`/categories/${c.slug}`}
                aria-current={catActive(c.slug) ? 'page' : undefined}
                className={`text-sm text-ink-700 transition-colors hover:text-brand-700 ${under(catActive(c.slug))}`}
              >
                {c.name}
              </Link>
            ))}
            <Link
              href="/track"
              aria-current={isTrack ? 'page' : undefined}
              className={`text-sm text-ink-700 transition-colors hover:text-brand-700 ${under(isTrack)}`}
            >
              Track order
            </Link>
          </nav>

          <div className="ml-auto hidden max-w-xs flex-1 md:block">
            <SearchForm />
          </div>

          <div className="ml-auto flex items-center gap-1 md:ml-2">
            <AccountMenu user={user} />

            <Link
              href="/cart"
              className="btn-press relative rounded-lg p-2 text-ink-700 transition-colors hover:bg-ink-900/5 hover:text-ink-900"
              aria-label={`Cart, ${cartCount} item${cartCount === 1 ? '' : 's'}`}
            >
              <svg
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.7}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z"
                />
              </svg>
              {cartCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-500 px-1 text-[11px] font-bold text-white shadow-soft">
                  {cartCount > 99 ? '99+' : cartCount}
                </span>
              )}
            </Link>
          </div>
        </div>

        <div className="pb-2 md:hidden">
          <SearchForm />
        </div>
      </div>
    </header>
  );
}
