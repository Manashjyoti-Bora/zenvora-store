import type { InventoryMovementReason, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';

/**
 * Inventory history + restock helpers. Stock VALUES only ever change inside
 * transactions (order creation, cancellation, RTO, admin adjustment, supplier
 * sync); every such change writes an InventoryMovement row so the admin can
 * audit "who/what changed stock, by how much, and the resulting level".
 */

export async function recordMovement(
  tx: Prisma.TransactionClient,
  params: {
    productId: string;
    variantId?: string | null;
    delta: number;
    reason: InventoryMovementReason;
    orderId?: string | null;
    actorId?: string | null;
    note?: string | null;
    stockAfter: number;
  }
): Promise<void> {
  await tx.inventoryMovement.create({
    data: {
      productId: params.productId,
      variantId: params.variantId ?? null,
      delta: params.delta,
      reason: params.reason,
      orderId: params.orderId ?? null,
      actorId: params.actorId ?? null,
      note: params.note ?? null,
      stockAfter: params.stockAfter,
    },
  });
}

/**
 * Restocks LOCAL-mode lines of an order (cancellation / return / RTO) and
 * writes the matching movements. Idempotent per (orderId, reason) via a
 * dedupe note so repeated calls cannot double-restock.
 */
export async function restockOrderItems(params: {
  orderId: string;
  reason: 'ORDER_CANCELLED' | 'RETURN_RESTOCK' | 'RTO_RESTOCK';
  actorId?: string | null;
}): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.inventoryMovement.findFirst({
      where: { orderId: params.orderId, reason: params.reason },
      select: { id: true },
    });
    if (existing) return 0; // already restocked for this reason

    const items = await tx.orderItem.findMany({
      where: { orderId: params.orderId },
      include: { product: { select: { id: true, stockMode: true } } },
    });
    let count = 0;
    for (const item of items) {
      if (!item.productId || item.product?.stockMode !== 'LOCAL') continue;
      if (item.variantId) {
        const updated = await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stock: { increment: item.quantity } },
          select: { stock: true, productId: true },
        });
        await recordMovement(tx, {
          productId: updated.productId,
          variantId: item.variantId,
          delta: item.quantity,
          reason: params.reason,
          orderId: params.orderId,
          actorId: params.actorId ?? null,
          stockAfter: updated.stock,
        });
      } else {
        const updated = await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
          select: { stock: true },
        });
        await recordMovement(tx, {
          productId: item.productId,
          delta: item.quantity,
          reason: params.reason,
          orderId: params.orderId,
          actorId: params.actorId ?? null,
          stockAfter: updated.stock,
        });
      }
      count += 1;
    }
    if (count > 0) {
      logger.info('Order lines restocked', { orderId: params.orderId, reason: params.reason, count });
    }
    return count;
  });
}
