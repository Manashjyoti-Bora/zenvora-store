import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { InventoryEditor, type InventoryRow } from '@/components/admin/inventory-editor';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Inventory — Admin', robots: { index: false } };

export default async function AdminInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const view = sp.view === 'low' || sp.view === 'out' || sp.view === 'sync' ? sp.view : 'all';

  const where = {
    status: { not: 'ARCHIVED' as const },
    ...(sp.q?.trim() ? { name: { contains: sp.q.trim(), mode: 'insensitive' as const } } : {}),
    ...(view === 'out' ? { stock: 0, hasVariants: false } : {}),
    ...(view === 'low' ? { stock: { gt: 0 }, hasVariants: false } : {}),
    ...(view === 'sync' ? { stockMode: 'SUPPLIER_SYNC' as const } : {}),
  };

  const products = await prisma.product.findMany({
    where,
    orderBy: [{ stock: 'asc' }, { name: 'asc' }],
    take: 200,
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      stockMode: true,
      hasVariants: true,
      stock: true,
      lowStockThreshold: true,
      variants: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, stock: true, isActive: true },
      },
    },
  });

  const rows: InventoryRow[] = products
    // Per-product low-stock threshold: column-vs-column compare done in app
    // layer (the where clause already narrowed to stock > 0, no variants).
    .filter((p) =>
      view === 'low' ? p.lowStockThreshold > 0 && p.stock <= p.lowStockThreshold : true
    )
    .map((p) => ({
    productId: p.id,
    name: p.name,
    slug: p.slug,
    status: p.status,
    stockMode: p.stockMode,
    hasVariants: p.hasVariants,
    stock: p.hasVariants ? p.variants.reduce((a, v) => a + v.stock, 0) : p.stock,
    lowStockThreshold: p.lowStockThreshold,
    variants: p.variants,
  }));

  const TABS = [
    { key: 'all', label: 'All products' },
    { key: 'low', label: 'Low stock' },
    { key: 'out', label: 'Out of stock' },
    { key: 'sync', label: 'Supplier-synced' },
  ];

  return (
    <div className="space-y-5">
      <header>
        <h1>Inventory &amp; fulfilment status</h1>
        <p className="mt-1 text-sm text-gray-500">
          Quick stock corrections and publish/unpublish. Supplier-synced products receive stock from
          supplier webhooks/syncs — manual values are overwritten on the next sync.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5" role="group" aria-label="Inventory views">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/admin/inventory?view=${t.key}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ''}`}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                view === t.key
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>
        <form method="get" action="/admin/inventory" className="ml-auto flex gap-2" role="search">
          <input type="hidden" name="view" value={view} />
          <input
            type="search"
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder="Search product…"
            className="input-base w-56"
            aria-label="Search products"
          />
          <button
            type="submit"
            className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
          >
            Search
          </button>
        </form>
      </div>

      <InventoryEditor initial={rows} />
    </div>
  );
}
