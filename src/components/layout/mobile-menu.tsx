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
        className="rounded-lg p-2 text-gray-700 hover:bg-gray-100"
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
          className="absolute inset-x-0 top-full z-40 max-h-[70vh] animate-fade-in overflow-y-auto border-b border-gray-200 bg-white px-4 py-3 shadow-lg"
        >
          <ul className="space-y-1">
            {!user && (
              <li className="mb-2 flex gap-2 border-b border-gray-100 pb-3">
                <Link
                  href="/auth/login"
                  onClick={() => setOpen(false)}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-center text-sm font-medium text-gray-700"
                >
                  Log in
                </Link>
                <Link
                  href="/auth/register"
                  onClick={() => setOpen(false)}
                  className="flex-1 rounded-lg bg-brand-600 px-3 py-2 text-center text-sm font-medium text-white"
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
                  className="block rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
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
