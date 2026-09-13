import { apiRoute, jsonOk, notFound, badRequest } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { getSupplierAdapter } from '@/lib/suppliers/registry';
import { auditLog } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Pull the supplier catalog (HTTP_REST suppliers with a products endpoint)
 * into supplier_products for mapping. Demo/manual suppliers honestly report
 * that catalog sync is unavailable.
 */
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const supplier = await prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw notFound('Supplier not found');

    const adapter = getSupplierAdapter(supplier);
    if (!adapter.capabilities.catalogSync || !adapter.getProducts) {
      throw badRequest(
        `Supplier type ${supplier.type} (${adapter.label}) does not support catalog sync. Add products manually or map supplier SKUs on the product form.`
      );
    }

    const products = await adapter.getProducts({ limit: 200 });
    let created = 0;
    let updated = 0;
    for (const p of products) {
      if (!p.sku) continue;
      const existing = await prisma.supplierProduct.findUnique({
        where: { supplierId_supplierSku: { supplierId: supplier.id, supplierSku: p.sku } },
      });
      const data = {
        externalId: p.externalId ?? null,
        supplierCost: ((p.costPaise ?? 0) / 100).toFixed(2),
        supplierShippingCost: p.shippingPaise != null ? (p.shippingPaise / 100).toFixed(2) : null,
        inStock: p.inStock ?? null,
        stockQty: p.qty ?? null,
        raw: (p.raw ?? {}) as object,
        lastSyncedAt: new Date(),
      };
      if (existing) {
        await prisma.supplierProduct.update({ where: { id: existing.id }, data });
        updated += 1;
      } else {
        await prisma.supplierProduct.create({
          data: { supplierId: supplier.id, supplierSku: p.sku, ...data },
        });
        created += 1;
      }
    }

    await auditLog({
      actor: { id: admin.id, email: admin.email },
      action: 'supplier.catalog_synced',
      entityType: 'Supplier',
      entityId: supplier.id,
      data: { created, updated },
      req,
    });
    return jsonOk({ created, updated, total: products.length });
  })(req, ctx);
}
