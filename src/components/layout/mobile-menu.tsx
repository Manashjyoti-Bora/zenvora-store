'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { SessionUser } from '@/lib/auth/session';

export function MobileMenu({
  categories,
  user,
}: {
  categories: Array<{ name: string; slug: string }>;
  user: SessionUser | null;
}) {
  const [open, setOpen] = useState(false);

  const links = [
    { href: '/shop', label: 'Shop all products' },
    ...categories.map((c) => ({ href: `/categories/${c.slug}`, label: c.name })),
    { href: '/track', label: 'Track order' },
    { href: '/about', label: 'About us' },
    { href: '/contact', label: 'Contact' },
    { href: '/faq', label: 'FAQ' },
  ];

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn-press rounded-lg p-2 text-ink-700 transition-colors hover:bg-ink-900/5 hover:text-ink-900"
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? 'Close menu' : 'Open menu'}
      >
        <svg
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.7}
          aria-hidden="true"
        >
          {open ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
            />
          )}
        </svg>
      </button>
      {open && (
        <nav
          id="mobile-nav"
          aria-label="Mobile navigation"
          className="absolute inset-x-0 top-full z-40 max-h-[70vh] animate-fade-in overflow-y-auto border-b border-ink-900/10 bg-cream-50 px-4 py-3 shadow-lift"
        >
          <ul className="space-y-1">
            {!user && (
              <li className="mb-2 flex gap-2 border-b border-ink-900/10 pb-3">
                <Link
                  href="/auth/login"
                  onClick={() => setOpen(false)}
                  className="btn-press flex-1 rounded-lg border border-ink-900/15 bg-white px-3 py-2 text-center text-sm font-semibold text-ink-800 transition-colors hover:border-ink-900/30"
                >
                  Log in
                </Link>
                <Link
                  href="/auth/register"
                  onClick={() => setOpen(false)}
                  className="btn-press flex-1 rounded-lg bg-brand-600 px-3 py-2 text-center text-sm font-semibold text-white shadow-soft transition-colors hover:bg-brand-700"
                >
                  Sign up
                </Link>
              </li>
            )}
            {links.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2.5 text-sm font-medium text-ink-800 transition-colors hover:bg-ink-900/5 active:bg-ink-900/10"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
