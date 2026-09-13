import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { ProductForm } from '@/components/admin/product-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'New product — Admin', robots: { index: false } };

export default async function NewProductPage() {
  const [categories, suppliers] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.supplier.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, type: true },
    }),
  ]);

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1>New product</h1>
          <p className="mt-1 text-sm text-gray-500">
            The selling price is computed by the pricing engine from your costs — see the live
            preview.
          </p>
        </div>
        <Link href="/admin/products" className="text-sm font-medium text-brand-700 hover:underline">
          ← Back to products
        </Link>
      </header>
      <ProductForm categories={categories} suppliers={suppliers} />
    </div>
  );
}
