import { apiRoute, jsonOk, badRequest, notFound } from '@/lib/errors';
import { supplierProductMapSchema } from '@/lib/validation/schemas';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { auditLog } from '@/lib/audit';
import { readJson } from '@/lib/http';
import { applyEnginePricingToProduct } from '@/lib/catalog/products';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Map a supplier product onto a catalog product (or unmap with null). */
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const sp = await prisma.supplierProduct.findUnique({ where: { id } });
    if (!sp) throw notFound('Supplier product not found');

    const raw = await readJson(req);
    if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
    const body = supplierProductMapSchema.parse({ ...raw, supplierProductId: id });

    if (body.productId) {
      const product = await prisma.product.findUnique({ where: { id: body.productId } });
      if (!product) throw notFound('Target product not found');
      const taken = await prisma.supplierProduct.findFirst({
        where: { productId: body.productId, id: { not: id } },
      });
      if (taken) {
        throw badRequest(
          'That product is already mapped to another supplier product. Unmap it first.'
        );
      }
    }

    const mapping = await prisma.supplierProduct.update({
      where: { id },
      data: {
        productId: body.productId ?? null,
        ...(body.supplierCost !== undefined
          ? { supplierCost: (body.supplierCost / 100).toFixed(2) }
          : {}),
      },
    });

    // Sync cost + supplier fields onto the mapped product, then re-run the
    // pricing engine so the selling price follows the new cost deterministically
    // (fixed-price overrides are preserved by the engine; margins never drift).
    let pricing = null;
    if (mapping.productId) {
      await prisma.product.update({
        where: { id: mapping.productId },
        data: {
          supplierId: mapping.supplierId,
          supplierSku: mapping.supplierSku,
          supplierCost: mapping.supplierCost,
          ...(mapping.supplierShippingCost !== null
            ? { supplierShippingCost: mapping.supplierShippingCost }
            : {}),
        },
      });
      pricing = await applyEnginePricingToProduct(mapping.productId);
    }

    await auditLog({
      actor: { id: admin.id, email: admin.email },
      action: body.productId ? 'supplier_product.mapped' : 'supplier_product.unmapped',
      entityType: 'SupplierProduct',
      entityId: id,
      data: { productId: body.productId, pricing },
      req,
    });
    return jsonOk({ mapping, pricing });
  })(req, ctx);
}
