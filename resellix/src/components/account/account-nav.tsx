'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/client/api';
import { BoxIcon, HomeIcon, LogoutIcon, PinIcon, ToolIcon, UserIcon } from '@/components/ui/icons';

const LINKS = [
  { href: '/account', label: 'Dashboard', Icon: HomeIcon, exact: true },
  { href: '/account/orders', label: 'My orders', Icon: BoxIcon, exact: false },
  { href: '/account/addresses', label: 'Addresses', Icon: PinIcon, exact: false },
  { href: '/account/profile', label: 'Profile & security', Icon: UserIcon, exact: false },
];

export function AccountNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const links = isAdmin
    ? [...LINKS, { href: '/admin', label: 'Admin panel', Icon: ToolIcon, exact: false }]
    : LINKS;

  async function logout() {
    setLoggingOut(true);
    try {
      await apiFetch('/api/auth/logout');
      router.push('/');
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <nav aria-label="Account" className="space-y-1">
      {links.map((l) => {
        const active = l.exact ? pathname === l.href : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-brand-50 text-brand-800'
                : 'text-ink-500 hover:bg-cream-50 hover:text-ink-900'
            )}
          >
            <l.Icon className="h-4 w-4 shrink-0" />
            {l.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={logout}
        disabled={loggingOut}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60"
      >
        <LogoutIcon className="h-4 w-4 shrink-0" />
        {loggingOut ? 'Logging out…' : 'Log out'}
      </button>
    </nav>
  );
}
