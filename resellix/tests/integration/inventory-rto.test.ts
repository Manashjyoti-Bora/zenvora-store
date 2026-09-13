import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { canTransition, transitionOrder } from '@/lib/orders/state';
import { restockOrderItems } from '@/lib/orders/inventory';

/**
 * Inventory history + RTO lifecycle:
 *  - SHIPPED/OUT_FOR_DELIVERY may go to RTO, RTO to RTO_RECEIVED, and
 *    RTO_RECEIVED to REFUND_PENDING/REFUNDED - nothing else may jump to RTO.
 *  - restockOrderItems increments LOCAL stock, writes InventoryMovement rows
 *    and is idempotent per (order, reason).
 */

const suffix = `rto${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let productId: string;
let orderId: string;

beforeAll(async () => {
  const product = await prisma.product.create({
    data: {
      name: `RTO fixture ${suffix}`,
      slug: `rto-fixture-${suffix}`,
      description: 'inventory/RTO test fixture',
      status: 'ACTIVE',
      stockMode: 'LOCAL',
      stock: 3, // simulates post-order stock (5 sold 2)
      sellingPrice: '999.00',
      supplierCost: '500.00',
    },
  });
  productId = product.id;

  const order = await prisma.order.create({
    data: {
      orderNumber: `RX-${suffix.toUpperCase()}`,
      subtotal: '1998.00',
      grandTotal: '1998.00',
      shippingAddress: { city: 'Hojai' },
      paymentMethod: 'COD',
      status: 'SHIPPED',
      paymentStatus: 'COD_PENDING',
      items: {
        create: {
          productId: product.id,
          quantity: 2,
          unitPrice: '999.00',
          unitSupplierCost: '500.00',
          lineTotal: '1998.00',
          productSnapshot: { name: product.name },
        },
      },
    },
  });
  orderId = order.id;
});

afterAll(async () => {
  await prisma.inventoryMovement.deleteMany({ where: { productId } });
  await prisma.orderItem.deleteMany({ where: { orderId } });
  await prisma.orderEvent.deleteMany({ where: { orderId } });
  await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.$disconnect();
});

describe('RTO state machine', () => {
  it('allows RTO only from shipping stages', () => {
    expect(canTransition('SHIPPED', 'RTO')).toBe(true);
    expect(canTransition('OUT_FOR_DELIVERY', 'RTO')).toBe(true);
    expect(canTransition('PENDING_PAYMENT', 'RTO')).toBe(false);
    expect(canTransition('DELIVERED', 'RTO')).toBe(false);
    expect(canTransition('RTO', 'RTO_RECEIVED')).toBe(true);
    expect(canTransition('RTO_RECEIVED', 'REFUND_PENDING')).toBe(true);
    expect(canTransition('RTO_RECEIVED', 'DELIVERED')).toBe(false);
  });

  it('transitions SHIPPED → RTO → RTO_RECEIVED with audit events', async () => {
    await transitionOrder({ orderId, to: 'RTO', actorType: 'ADMIN', message: 'Courier RTO' });
    const mid = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(mid.status).toBe('RTO');

    await transitionOrder({ orderId, to: 'RTO_RECEIVED', actorType: 'ADMIN', message: 'Parcel back' });
    const end = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(end.status).toBe('RTO_RECEIVED');

    const events = await prisma.orderEvent.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
    const statuses = events.map((e) => e.toStatus);
    expect(statuses).toContain('RTO');
    expect(statuses).toContain('RTO_RECEIVED');
  });

  it('rejects an illegal RTO_RECEIVED → DELIVERED jump', async () => {
    await expect(
      transitionOrder({ orderId, to: 'DELIVERED', actorType: 'ADMIN' })
    ).rejects.toThrow();
  });
});

describe('RTO restock + inventory movements', () => {
  it('restocks LOCAL lines once and records history', async () => {
    const n = await restockOrderItems({ orderId, reason: 'RTO_RESTOCK', actorId: null });
    expect(n).toBe(1);

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.stock).toBe(5); // 3 + 2 back in sellable stock

    const movements = await prisma.inventoryMovement.findMany({
      where: { productId, reason: 'RTO_RESTOCK' },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0].delta).toBe(2);
    expect(movements[0].stockAfter).toBe(5);
    expect(movements[0].orderId).toBe(orderId);
  });

  it('is idempotent: a second call does not double-restock', async () => {
    const n = await restockOrderItems({ orderId, reason: 'RTO_RESTOCK', actorId: null });
    expect(n).toBe(0);
    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.stock).toBe(5);
  });
});
