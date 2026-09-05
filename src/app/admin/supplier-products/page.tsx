import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import {
  SupplierProductMapper,
  type SupplierProductRow,
} from '@/components/admin/supplier-product-mapper';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Supplier product mapping — Admin',
  robots: { index: false },
};

export default async function SupplierProductsPage() {
  const [supplierProducts, products] = await Promise.all([
    prisma.supplierProduct.findMany({
      orderBy: [{ productId: 'asc' }, { updatedAt: 'desc' }],
      take: 500,
      include: {
        supplier: { select: { name: true } },
        product: { select: { name: true, slug: true } },
      },
    }),
    prisma.product.findMany({
      where: { status: { not: 'ARCHIVED' } },
      orderBy: { name: 'asc' },
      take: 500,
      select: { id: true, name: true, supplierSku: true },
    }),
  ]);

  const rows: SupplierProductRow[] = supplierProducts.map((sp) => ({
    id: sp.id,
    supplierId: sp.supplierId,
    supplierName: sp.supplier.name,
    supplierSku: sp.supplierSku,
    externalId: sp.externalId,
    supplierCost: Number(sp.supplierCost),
    supplierShippingCost: sp.supplierShippingCost != null ? Number(sp.supplierShippingCost) : null,
    stockQty: sp.stockQty,
    inStock: sp.inStock,
    isActive: sp.isActive,
    lastSyncedAt: sp.lastSyncedAt?.toISOString() ?? null,
    productId: sp.productId,
    productName: sp.product?.name ?? null,
    productSlug: sp.product?.slug ?? null,
  }));

  return (
    <div className="space-y-5">
      <header>
        <h1>Supplier product mapping</h1>
        <p className="mt-1 text-sm text-gray-500">
          Every synced supplier catalog entry across all suppliers. Unmapped entries cannot be
          ordered automatically — map them to catalog products (costs sync on save).
        </p>
      </header>
      <SupplierProductMapper initial={rows} products={products} showSupplierColumn />
    </div>
  );
}
