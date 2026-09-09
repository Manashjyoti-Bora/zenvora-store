import { apiRoute, jsonOk, badRequest, notFound } from '@/lib/errors';
import { inventoryUpdateSchema } from '@/lib/validation/schemas';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { auditLog } from '@/lib/audit';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Quick inventory/status updates from the Inventory screen. */
export const PATCH = apiRoute(async (req: Request) => {
  const admin = await requireAdmin();
  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = inventoryUpdateSchema.parse(raw);

  const product = await prisma.product.findUnique({ where: { id: body.productId } });
  if (!product) throw notFound('Product not found');

  if (body.variantId) {
    const variant = await prisma.productVariant.findFirst({
      where: { id: body.variantId, productId: product.id },
    });
    if (!variant) throw notFound('Variant not found');
    const oldStock = variant.stock;
    await prisma.productVariant.update({
      where: { id: variant.id },
      data: {
        ...(body.stock != null ? { stock: body.stock } : {}),
        ...(body.variantActive != null ? { isActive: body.variantActive } : {}),
      },
    });
    if (body.stock != null && body.stock !== oldStock) {
      await prisma.inventoryMovement.create({
        data: {
          productId: product.id,
          variantId: variant.id,
          delta: body.stock - oldStock,
          reason: 'ADJUSTMENT',
          actorId: admin.id,
          note: 'Admin inventory update',
          stockAfter: body.stock,
        },
      });
    }
  } else {
    const oldStock = product.stock;
    await prisma.product.update({
      where: { id: product.id },
      data: {
        ...(body.stock != null ? { stock: body.stock } : {}),
        ...(body.lowStockThreshold != null ? { lowStockThreshold: body.lowStockThreshold } : {}),
        ...(body.status ? { status: body.status } : {}),
      },
    });
    if (body.stock != null && body.stock !== oldStock) {
      await prisma.inventoryMovement.create({
        data: {
          productId: product.id,
          delta: body.stock - oldStock,
          reason: 'ADJUSTMENT',
          actorId: admin.id,
          note: 'Admin inventory update',
          stockAfter: body.stock,
        },
      });
    }
  }

  await auditLog({
    actor: { id: admin.id, email: admin.email },
    action: 'inventory.updated',
    entityType: 'Product',
    entityId: product.id,
    data: body as unknown as Record<string, unknown>,
    req,
  });
  return jsonOk({ updated: true });
});
