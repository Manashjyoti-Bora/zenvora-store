import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { CouponManager } from '@/components/admin/coupon-manager';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Coupons — Admin', robots: { index: false } };

export default async function AdminCouponsPage() {
  const [coupons, categories] = await Promise.all([
    prisma.coupon.findMany({
      orderBy: { createdAt: 'desc' },
      include: { category: { select: { name: true } } },
    }),
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="space-y-5">
      <header>
        <h1>Coupons</h1>
        <p className="mt-1 text-sm text-gray-500">
          Discounts are always re-validated server-side at cart and checkout — codes shown in the UI
          can never be manipulated into larger discounts.
        </p>
      </header>
      <CouponManager
        categories={categories}
        initial={coupons.map((c) => ({
          code: c.code,
          description: c.description,
          type: c.type,
          value: Number(c.value),
          scope: c.scope,
          categoryId: c.categoryId,
          categoryName: c.category?.name ?? null,
          minOrderAmount: c.minOrderAmount != null ? Number(c.minOrderAmount) : null,
          maxDiscountAmount: c.maxDiscountAmount != null ? Number(c.maxDiscountAmount) : null,
          usageLimit: c.usageLimit,
          usageCount: c.usageCount,
          perUserLimit: c.perUserLimit,
          startsAt: c.startsAt?.toISOString() ?? null,
          endsAt: c.endsAt?.toISOString() ?? null,
          isActive: c.isActive,
          bypassMarginProtection: c.bypassMarginProtection,
          firstOrderOnly: c.firstOrderOnly,
        }))}
      />
    </div>
  );
}
