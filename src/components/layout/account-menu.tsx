'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { apiFetch } from '@/lib/client/api';
import type { SessionUser } from '@/lib/auth/session';

export function AccountMenu({ user }: { user: SessionUser | null }) {
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function logout() {
    setLoggingOut(true);
    try {
      await apiFetch('/api/auth/logout');
      router.push('/');
      router.refresh();
    } finally {
      setLoggingOut(false);
      setOpen(false);
    }
  }

  if (!user) {
    return (
      <Link
        href="/auth/login"
        className="hidden rounded-lg p-2 text-gray-700 hover:bg-gray-100 sm:block"
        aria-label="Log in to your account"
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
            d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
          />
        </svg>
      </Link>
    );
  }

  const isAdmin = user.role === 'ADMIN' || user.role === 'STAFF';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg p-1.5 text-gray-700 hover:bg-gray-100"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account menu for ${user.name}`}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">
          {user.name.slice(0, 1).toUpperCase()}
        </span>
        <svg
          className="hidden h-4 w-4 sm:block"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 z-50 mt-2 w-56 animate-fade-in overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
        >
          <div className="border-b border-gray-100 px-4 py-3">
            <p className="truncate text-sm font-semibold text-gray-900">{user.name}</p>
            <p className="truncate text-xs text-gray-500">{user.email}</p>
          </div>
          <div className="py-1">
            <MenuItem href="/account" label="Dashboard" />
            <MenuItem href="/account/orders" label="My orders" />
            <MenuItem href="/account/addresses" label="Addresses" />
            <MenuItem href="/account/profile" label="Profile & password" />
            {isAdmin && <MenuItem href="/admin" label="Admin panel" strong />}
          </div>
          <div className="border-t border-gray-100 p-2">
            <button
              type="button"
              role="menuitem"
              onClick={logout}
              disabled={loggingOut}
              className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
            >
              {loggingOut ? 'Logging out…' : 'Log out'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({ href, label, strong }: { href: string; label: string; strong?: boolean }) {
  return (
    <Link
      href={href}
      role="menuitem"
      className={`block px-4 py-2 text-sm hover:bg-gray-50 ${strong ? 'font-semibold text-brand-700' : 'text-gray-700'}`}
    >
      {label}
    </Link>
  );
}
