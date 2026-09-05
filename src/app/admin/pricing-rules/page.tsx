import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { PricingRuleManager } from '@/components/admin/pricing-rule-manager';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Pricing rules — Admin', robots: { index: false } };

export default async function AdminPricingRulesPage() {
  const [rules, categories, suppliers, products] = await Promise.all([
    prisma.pricingRule.findMany({
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      include: {
        supplier: { select: { name: true } },
        category: { select: { name: true } },
        product: { select: { name: true } },
      },
    }),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.supplier.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.product.findMany({
      where: { status: { not: 'ARCHIVED' } },
      orderBy: { name: 'asc' },
      take: 500,
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="space-y-5">
      <header>
        <h1>Pricing rules</h1>
        <p className="mt-1 text-sm text-gray-500">
          Override margins per supplier, category or product without editing each product.
        </p>
      </header>
      <PricingRuleManager
        categories={categories}
        suppliers={suppliers}
        products={products}
        initial={rules.map((r) => ({
          id: r.id,
          name: r.name,
          scope: r.scope,
          supplierId: r.supplierId,
          categoryId: r.categoryId,
          productId: r.productId,
          supplierName: r.supplier?.name ?? null,
          categoryName: r.category?.name ?? null,
          productName: r.product?.name ?? null,
          mode: r.mode,
          fixedMargin: r.fixedMargin != null ? Number(r.fixedMargin) : null,
          percentMarkup: r.percentMarkup != null ? Number(r.percentMarkup) : null,
          minProfit: r.minProfit != null ? Number(r.minProfit) : null,
          roundingRule: r.roundingRule,
          priority: r.priority,
          isActive: r.isActive,
        }))}
      />
    </div>
  );
}
