'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/client/api';

interface NavItem {
  href: string;
  label: string;
}
interface NavGroup {
  title: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { href: '/admin', label: 'Dashboard' },
      { href: '/admin/analytics', label: 'Analytics & profit' },
      { href: '/admin/health', label: 'System health' },
    ],
  },
  {
    title: 'Catalog',
    items: [
      { href: '/admin/products', label: 'Products' },
      { href: '/admin/categories', label: 'Categories' },
      { href: '/admin/inventory', label: 'Inventory' },
      { href: '/admin/products/import', label: 'CSV import' },
      { href: '/admin/products/reprice', label: 'Bulk reprice' },
      { href: '/admin/pricing-rules', label: 'Pricing rules' },
      { href: '/admin/coupons', label: 'Coupons' },
    ],
  },
  {
    title: 'Suppliers',
    items: [
      { href: '/admin/suppliers', label: 'Suppliers' },
      { href: '/admin/supplier-products', label: 'Product mapping' },
      { href: '/admin/supplier-orders', label: 'Supplier orders' },
    ],
  },
  {
    title: 'Sales',
    items: [
      { href: '/admin/orders', label: 'Orders' },
      { href: '/admin/payments', label: 'Payments' },
      { href: '/admin/refunds', label: 'Refunds' },
      { href: '/admin/returns', label: 'Returns' },
      { href: '/admin/shipments', label: 'Shipments' },
      { href: '/admin/customers', label: 'Customers' },
      { href: '/admin/messages', label: 'Messages' },
    ],
  },
  {
    title: 'System',
    items: [
      { href: '/admin/settings', label: 'Settings' },
      { href: '/admin/users', label: 'Users & roles' },
      { href: '/admin/logs/jobs', label: 'Job queue' },
      { href: '/admin/logs/webhooks', label: 'Webhook log' },
      { href: '/admin/logs/audit', label: 'Audit log' },
    ],
  },
];

export function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const g of GROUPS) {
      initial[g.title] = g.items.some((i) =>
        i.href === '/admin' ? pathname === '/admin' : pathname.startsWith(i.href)
      );
    }
    return initial;
  });
  const [loggingOut, setLoggingOut] = useState(false);

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
    <nav aria-label="Admin sections" className="space-y-1">
      {GROUPS.map((group) => {
        const open = openGroups[group.title];
        return (
          <div key={group.title}>
            <button
              type="button"
              onClick={() => setOpenGroups((g) => ({ ...g, [group.title]: !g[group.title] }))}
              aria-expanded={open}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-400 hover:text-gray-600"
            >
              {group.title}
              <span aria-hidden="true" className={cn('transition-transform', open && 'rotate-90')}>
                ›
              </span>
            </button>
            {open && (
              <ul className="mt-0.5 space-y-0.5">
                {group.items.map((item) => {
                  const active =
                    item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'block rounded-lg px-3 py-1.5 text-sm transition-colors',
                          active
                            ? 'bg-brand-600 font-semibold text-white'
                            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                        )}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
      <div className="border-t border-gray-200 pt-2">
        <Link
          href="/"
          className="block rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
        >
          ← View store
        </Link>
        <button
          type="button"
          onClick={logout}
          disabled={loggingOut}
          className="block w-full rounded-lg px-3 py-1.5 text-left text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
        >
          {loggingOut ? 'Logging out…' : 'Log out'}
        </button>
      </div>
    </nav>
  );
}
