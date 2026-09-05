import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { RepriceTool } from '@/components/admin/reprice-tool';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Bulk reprice — Admin', robots: { index: false } };

export default async function RepricePage() {
  const [categories, suppliers] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.supplier.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="space-y-5">
      <header>
        <h1>Bulk repricing</h1>
        <p className="mt-1 text-sm text-gray-500">
          Re-run the pricing engine across a scope after changing rules or costs. Always preview
          before applying.
        </p>
      </header>
      <RepriceTool categories={categories} suppliers={suppliers} />
    </div>
  );
}
