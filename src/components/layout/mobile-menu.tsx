'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { focusablesIn, lockBodyScroll, nextFocusTarget } from '@/lib/a11y/focus';
import type { SessionUser } from '@/lib/auth/session';

export function MobileMenu({
  categories,
  user,
}: {
  categories: Array<{ name: string; slug: string }>;
  user: SessionUser | null;
}) {
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const pathname = usePathname();

  // Keyboard + scroll behaviour while the disclosure is open, mirroring the
  // app's <Modal>: focus enters the panel, Tab cycles inside it, Escape
  // closes, and the page behind it cannot scroll.
  useEffect(() => {
    if (!open) return;
    const nav = navRef.current;
    // Snapshot the trigger: refs can change before cleanup runs (React 19).
    const trigger = triggerRef.current;
    nav?.focus();

    const releaseScrollLock = lockBodyScroll();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const target = nextFocusTarget(focusablesIn(nav), document.activeElement, e.shiftKey);
      if (!target) return;
      e.preventDefault();
      target.focus();
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      releaseScrollLock();
      // Return focus to the control that opened the panel.
      trigger?.focus();
    };
  }, [open]);

  // Any navigation (link click, back/forward, programmatic) closes the panel.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const catalogLinks = [
    { href: '/shop', label: 'All products' },
    { href: '/shop?sort=newest', label: 'New arrivals' },
    ...categories.map((c) => ({ href: `/categories/${c.slug}`, label: c.name })),
  ];

  const supportLinks = [
    { href: '/wishlist', label: 'Saved wishlist' },
    { href: '/track', label: 'Track an order' },
    { href: '/about', label: 'About the store' },
    { href: '/contact', label: 'Customer support' },
    { href: '/faq', label: 'FAQ & policies' },
  ];

  return (
    <div className="lg:hidden">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn-press flex h-10 w-10 items-center justify-center rounded-lg text-ink-800 transition-colors hover:bg-ink-900/5 hover:text-ink-950"
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? 'Close menu' : 'Open menu'}
      >
        <svg
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.8}
          aria-hidden="true"
        >
          {open ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h12"
            />
          )}
        </svg>
      </button>

      {open && (
        <>
          <div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            className="glass-scrim fixed inset-x-0 bottom-0 top-14 z-30 h-screen"
          />
          <nav
            ref={navRef}
            id="mobile-nav"
            aria-label="Mobile navigation"
            tabIndex={-1}
            className="glass-drawer motion-reveal absolute inset-x-0 top-full max-h-[78vh] overflow-y-auto rounded-none border-x-0 border-t-0 px-4 py-4 focus:outline-none"
          >
            {user ? (
              <div className="mb-4 flex items-center justify-between gap-2 rounded-xl border border-ink-900/10 bg-white p-3 shadow-hair">
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-ink-900">{user.name}</p>
                  <p className="truncate text-[11px] text-ink-400">{user.email}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Link
                    href="/account"
                    onClick={() => setOpen(false)}
                    className="btn-press rounded-lg border border-ink-900/15 bg-cream-50 px-2.5 py-1.5 text-xs font-semibold text-ink-800 hover:bg-cream-100"
                  >
                    Account
                  </Link>
                  {user.role === 'ADMIN' && (
                    <Link
                      href="/admin"
                      onClick={() => setOpen(false)}
                      className="btn-press rounded-lg bg-ink-900 px-2.5 py-1.5 text-xs font-semibold text-accent-300"
                    >
                      Admin
                    </Link>
                  )}
                </div>
              </div>
            ) : (
              <div className="mb-4 grid grid-cols-2 gap-2 border-b border-ink-900/10 pb-3.5">
                <Link
                  href="/auth/login"
                  onClick={() => setOpen(false)}
                  className="btn-press rounded-lg border border-ink-900/15 bg-white px-3 py-2.5 text-center text-sm font-semibold text-ink-800 shadow-hair transition-colors hover:border-ink-900/30"
                >
                  Log in
                </Link>
                <Link
                  href="/auth/register"
                  onClick={() => setOpen(false)}
                  className="btn-press rounded-lg bg-brand-600 px-3 py-2.5 text-center text-sm font-semibold text-white shadow-soft transition-colors hover:bg-brand-700"
                >
                  Sign up
                </Link>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <p className="eyebrow px-2 text-ink-400">Catalog</p>
                <ul className="mt-1.5 grid grid-cols-1 gap-0.5">
                  {catalogLinks.map((l) => (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        onClick={() => setOpen(false)}
                        className="flex items-center justify-between rounded-lg px-2.5 py-2 text-sm font-medium text-ink-800 transition-colors hover:bg-ink-900/5 active:bg-ink-900/10"
                      >
                        <span>{l.label}</span>
                        <span className="text-xs text-ink-300" aria-hidden="true">
                          →
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border-t border-ink-900/10 pt-3">
                <p className="eyebrow px-2 text-ink-400">Orders &amp; support</p>
                <ul className="mt-1.5 grid grid-cols-2 gap-1">
                  <li>
                    <Link
                      href="/wishlist"
                      onClick={() => setOpen(false)}
                      className="block rounded-lg bg-white/80 px-2.5 py-2 text-xs font-semibold text-brand-700 ring-1 ring-ink-900/5 transition-colors hover:bg-white hover:text-brand-800"
                    >
                      My Wishlist
                    </Link>
                  </li>
                  {supportLinks.map((l) => (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        onClick={() => setOpen(false)}
                        className="block rounded-lg bg-white/80 px-2.5 py-2 text-xs font-semibold text-ink-700 ring-1 ring-ink-900/5 transition-colors hover:bg-white hover:text-ink-950"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
