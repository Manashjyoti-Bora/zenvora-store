import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { CategoryManager } from '@/components/admin/category-manager';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Categories — Admin', robots: { index: false } };

export default async function AdminCategoriesPage() {
  const categories = await prisma.category.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { products: true } } },
  });

  return (
    <div className="space-y-5">
      <header>
        <h1>Categories</h1>
        <p className="mt-1 text-sm text-gray-500">
          Categories organise the storefront, power pricing rules and category-scoped coupons.
        </p>
      </header>
      <CategoryManager
        initial={categories.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          description: c.description,
          sortOrder: c.sortOrder,
          isActive: c.isActive,
          seoTitle: c.seoTitle,
          seoDescription: c.seoDescription,
          productCount: c._count.products,
        }))}
      />
    </div>
  );
}
