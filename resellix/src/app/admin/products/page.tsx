import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { prisma } from '@/lib/db';
import { toPaise, formatINR } from '@/lib/money';
import { TableWrap, Th, Td, Pagination } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/feedback';
import { LinkButton } from '@/components/ui/button';
import type { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Products — Admin', robots: { index: false } };

const PER_PAGE = 20;

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    category?: string;
    supplier?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const where: Prisma.ProductWhereInput = {};
  if (sp.q?.trim()) {
    const term = sp.q.trim();
    where.OR = [
      { name: { contains: term, mode: 'insensitive' } },
      { slug: { contains: term, mode: 'insensitive' } },
      { sku: { contains: term, mode: 'insensitive' } },
      { supplierSku: { contains: term, mode: 'insensitive' } },
    ];
  }
  if (sp.status && ['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(sp.status))
    where.status = sp.status as Prisma.EnumProductStatusFilter['equals'];
  if (sp.category) where.categoryId = sp.category;
  if (sp.supplier) where.supplierId = sp.supplier;

  const [products, total, categories, suppliers] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        category: { select: { name: true } },
        supplier: { select: { name: true } },
        images: {
          take: 1,
          orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
          select: { url: true },
        },
        variants: { where: { isActive: true }, select: { stock: true } },
      },
    }),
    prisma.product.count({ where }),
    prisma.category.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.supplier.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Products</h1>
          <p className="mt-1 text-sm tabular-nums text-gray-500">
            {total} product{total === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/admin/products/import" variant="outline" size="sm">
            CSV import
          </LinkButton>
          <LinkButton href="/admin/products/reprice" variant="outline" size="sm">
            Bulk reprice
          </LinkButton>
          <LinkButton href="/admin/products/new" size="sm">
            + New product
          </LinkButton>
        </div>
      </header>

      {/* Filters */}
      <form
        className="flex flex-wrap items-center gap-2"
        method="get"
        action="/admin/products"
        role="search"
      >
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ''}
          placeholder="Search name / SKU…"
          className="input-base w-full max-w-xs"
          aria-label="Search products"
        />
        <select
          name="status"
          defaultValue={sp.status ?? ''}
          className="input-base w-auto"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="DRAFT">Draft</option>
          <option value="ARCHIVED">Archived</option>
        </select>
        <select
          name="category"
          defaultValue={sp.category ?? ''}
          className="input-base w-auto"
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          name="supplier"
          defaultValue={sp.supplier ?? ''}
          className="input-base w-auto"
          aria-label="Filter by supplier"
        >
          <option value="">All suppliers</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Filter
        </button>
        {(sp.q || sp.status || sp.category || sp.supplier) && (
          <Link href="/admin/products" className="text-sm text-brand-700 hover:underline">
            Clear
          </Link>
        )}
      </form>

      {products.length === 0 ? (
        <EmptyState
          icon="📦"
          title="No products match"
          description="Adjust the filters, create a product, or import a CSV."
          action={<LinkButton href="/admin/products/new">+ New product</LinkButton>}
        />
      ) : (
        <TableWrap>
          <table className="table-base">
            <thead className="bg-gray-50">
              <tr>
                <Th>Product</Th>
                <Th className="hidden md:table-cell">Status</Th>
                <Th>Price</Th>
                <Th className="hidden lg:table-cell">Cost</Th>
                <Th className="hidden lg:table-cell">Margin</Th>
                <Th>Stock</Th>
                <Th className="hidden md:table-cell">Supplier</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {products.map((p) => {
                const price = toPaise(p.sellingPrice);
                const cost =
                  toPaise(p.supplierCost) + toPaise(p.supplierShippingCost) + toPaise(p.otherCost);
                const marginPct = price > 0 ? ((price - cost) / price) * 100 : 0;
                const stock = p.hasVariants ? p.variants.reduce((a, v) => a + v.stock, 0) : p.stock;
                return (
                  <tr key={p.id} className="hover:bg-gray-50/60">
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                          {p.images[0] ? (
                            <Image
                              src={p.images[0].url}
                              alt=""
                              fill
                              sizes="40px"
                              className="object-cover"
                              unoptimized={!p.images[0].url.startsWith('/')}
                            />
                          ) : (
                            <span
                              className="flex h-full items-center justify-center text-sm text-gray-300"
                              aria-hidden="true"
                            >
                              🛍️
                            </span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <Link
                            href={`/admin/products/${p.id}`}
                            className="line-clamp-1 max-w-[220px] text-sm font-semibold text-gray-900 hover:text-brand-700"
                          >
                            {p.name}
                          </Link>
                          <p className="text-[11px] text-gray-400">
                            {p.sku ? `SKU ${p.sku}` : p.slug}
                            {p.category ? ` · ${p.category.name}` : ''}
                          </p>
                        </div>
                      </div>
                    </Td>
                    <Td className="hidden md:table-cell">
                      <Badge
                        tone={
                          p.status === 'ACTIVE' ? 'green' : p.status === 'DRAFT' ? 'amber' : 'gray'
                        }
                      >
                        {p.status}
                      </Badge>
                    </Td>
                    <Td className="font-medium tabular-nums">{formatINR(price)}</Td>
                    <Td className="hidden tabular-nums text-gray-500 lg:table-cell">
                      {formatINR(cost)}
                    </Td>
                    <Td className="hidden lg:table-cell">
                      <span
                        className={
                          marginPct < 0
                            ? 'font-semibold tabular-nums text-red-600'
                            : 'tabular-nums text-gray-600'
                        }
                      >
                        {marginPct.toFixed(1)}%
                      </span>
                      <span className="block text-[10px] text-gray-300">gross, pre-fees</span>
                    </Td>
                    <Td>
                      <span
                        className={
                          stock === 0
                            ? 'font-semibold text-red-600'
                            : stock <= 5
                              ? 'font-medium text-amber-600'
                              : 'text-gray-700'
                        }
                      >
                        {stock}
                      </span>
                      {p.hasVariants && (
                        <span className="block text-[10px] text-gray-400">across variants</span>
                      )}
                    </Td>
                    <Td className="hidden max-w-[140px] truncate text-gray-500 md:table-cell">
                      {p.supplier?.name ?? <span className="text-gray-300">manual</span>}
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-2 text-xs">
                        <Link
                          href={`/admin/products/${p.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          Edit
                        </Link>
                        {p.status === 'ACTIVE' && (
                          <Link
                            href={`/products/${p.slug}`}
                            target="_blank"
                            className="font-medium text-gray-500 hover:underline"
                          >
                            View ↗
                          </Link>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        basePath="/admin/products"
        searchParams={{ q: sp.q, status: sp.status, category: sp.category, supplier: sp.supplier }}
      />
      <p className="text-[11px] text-gray-400" aria-hidden="true">
        “Margin” in this list is gross margin (price − supplier costs) ÷ price. Real profit per
        order deducts gateway fees, shipping and refunds — see Analytics.
      </p>
    </div>
  );
}
