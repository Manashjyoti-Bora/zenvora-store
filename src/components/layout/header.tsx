import Link from 'next/link';
import { headers } from 'next/headers';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth/guards';
import { getCartItemCount } from '@/lib/cart/service';
import { getWishlistViewReadOnly } from '@/lib/wishlist/service';
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
      ? 'relative font-semibold text-ink-900 after:absolute after:-bottom-1.5 after:left-0 after:h-[2px] after:w-full after:rounded-full after:bg-accent-300'
      : '';
  const isShop = pathname === '/shop' || pathname.startsWith('/shop/');
  const isTrack = pathname === '/track' || pathname.startsWith('/track/');
  const catActive = (slug: string) =>
    pathname === `/categories/${slug}` || pathname.startsWith(`/categories/${slug}/`);
  const [cartCount, wishlist, settings, categories] = await Promise.all([
    getCartItemCount(user?.id ?? null),
    getWishlistViewReadOnly(user?.id ?? null),
    getSettings(),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take: 7,
      select: { name: true, slug: true },
    }),
  ]);

  return (
    <header className="glass-bar sticky top-0 z-40 border-x-0 border-t-0">
      <div className="container-store">
        <div className="flex h-14 items-center gap-2 sm:gap-3">
          <MobileMenu categories={categories} user={user} />

          <Link
            href="/"
            className="group flex min-w-0 shrink-0 items-center gap-2"
            aria-label={`${settings.storeName} home`}
          >
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-700 text-sm font-black text-accent-300 ring-1 ring-accent-400/30 transition-transform duration-200 ease-zenvora [@media(hover:hover)]:group-hover:-rotate-6"
            >
              {settings.storeName.slice(0, 1).toUpperCase()}
            </span>
            <span className="max-w-[130px] truncate text-sm font-extrabold uppercase tracking-[0.14em] text-ink-900 sm:max-w-none sm:text-base sm:tracking-[0.18em]">
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

          <div className="ml-auto flex shrink-0 items-center gap-1 md:ml-2">
            <AccountMenu user={user} />

            <Link
              href="/wishlist"
              className="btn-press relative flex h-10 w-10 items-center justify-center rounded-lg text-ink-800 transition-colors hover:bg-ink-900/5 hover:text-ink-950"
              aria-label={`Wishlist, ${wishlist.count} saved item${wishlist.count === 1 ? '' : 's'}`}
            >
              <svg
                className="h-5 w-5 sm:h-6 sm:w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.75}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
                />
              </svg>
              {wishlist.count > 0 && (
                <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ink-900 px-1 text-[10px] font-bold text-cream-50 shadow-soft">
                  {wishlist.count > 99 ? '99+' : wishlist.count}
                </span>
              )}
            </Link>

            <Link
              href="/cart"
              className="btn-press relative flex h-10 w-10 items-center justify-center rounded-lg text-ink-800 transition-colors hover:bg-ink-900/5 hover:text-ink-950"
              aria-label={`Cart, ${cartCount} item${cartCount === 1 ? '' : 's'}`}
            >
              <svg
                className="h-5 w-5 sm:h-6 sm:w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.75}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z"
                />
              </svg>
              {cartCount > 0 && (
                <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-white shadow-soft">
                  {cartCount > 99 ? '99+' : cartCount}
                </span>
              )}
            </Link>
          </div>
        </div>

        <div className="pb-2.5 md:hidden">
          <SearchForm />
        </div>
      </div>
    </header>
  );
}
