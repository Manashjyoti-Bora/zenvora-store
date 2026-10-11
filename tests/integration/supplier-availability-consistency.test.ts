import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { addToCart, getCartView, lineAvailable, loadCartItems } from '@/lib/cart/service';
import { createOrderFromCart } from '@/lib/orders/create';
import {
  availabilityOf,
  getStorefrontProduct,
  listStorefrontProducts,
} from '@/lib/catalog/storefront';
import { clearCookieJar } from './mock-headers';
import {
  cleanupTestData,
  createTestProduct,
  createTestSupplier,
  createTestUser,
  TEST_ADDRESS,
  unique,
} from './fixtures';

/**
 * Supplier-synced availability must be CONSISTENT across storefront, product
 * page, cart and checkout, and must never be inferred from the merchant stock
 * counter (which no supplier feed writes).
 *
 * The high-risk path this pins down: a supplier product whose merchant counter
 * says "in stock" but whose fresh supplier report says "out of stock" used to
 * be orderable — the failure only surfaced at fulfilment, AFTER the customer
 * had paid.
 */

const FRESH = () => new Date(Date.now() - 60_000); // 1 minute ago
const STALE = () => new Date(Date.now() - 7 * 24 * 3600e3); // a week ago

describe('supplier-synced availability is consistent end to end', () => {
  let supplierId: string;
  let outOfStockProductId: string;
  let outOfStockSlug: string;
  let inStockProductId: string;
  let staleProductId: string;
  let userId: string;
  let userEmail: string;

  beforeAll(async () => {
    await cleanupTestData();
    const supplier = await createTestSupplier();
    supplierId = supplier.id;

    // Merchant counter deliberately says 99 — it must be IGNORED for
    // supplier-synced products.
    const outOfStock = await createTestProduct({
      name: 'Itest Supplier Sold Out',
      stockMode: 'SUPPLIER_SYNC',
      stock: 99,
      sellingPrice: '499.00',
    });
    outOfStockProductId = outOfStock.id;
    outOfStockSlug = outOfStock.slug;
    await prisma.product.update({
      where: { id: outOfStockProductId },
      data: { supplierId },
    });
    await prisma.supplierProduct.create({
      data: {
        supplierId,
        productId: outOfStockProductId,
        supplierSku: unique('CJ-OOS').toUpperCase(),
        supplierCost: '200.00',
        inStock: false,
        stockQty: 0,
        lastSyncedAt: FRESH(),
      },
    });

    const inStock = await createTestProduct({
      name: 'Itest Supplier In Stock',
      stockMode: 'SUPPLIER_SYNC',
      stock: 0,
      sellingPrice: '299.00',
    });
    inStockProductId = inStock.id;
    await prisma.product.update({ where: { id: inStockProductId }, data: { supplierId } });
    await prisma.supplierProduct.create({
      data: {
        supplierId,
        productId: inStockProductId,
        supplierSku: unique('CJ-OK').toUpperCase(),
        supplierCost: '150.00',
        inStock: true,
        stockQty: 40,
        lastSyncedAt: FRESH(),
      },
    });

    // Supplier data is a week old → we must not claim anything.
    const stale = await createTestProduct({
      name: 'Itest Supplier Stale',
      stockMode: 'SUPPLIER_SYNC',
      stock: 0,
      sellingPrice: '199.00',
    });
    staleProductId = stale.id;
    await prisma.product.update({ where: { id: staleProductId }, data: { supplierId } });
    await prisma.supplierProduct.create({
      data: {
        supplierId,
        productId: staleProductId,
        supplierSku: unique('CJ-STALE').toUpperCase(),
        supplierCost: '100.00',
        inStock: true,
        stockQty: 25,
        lastSyncedAt: STALE(),
      },
    });

    // No notification/session side effects: this file only needs the user row.
    const user = await createTestUser({ name: 'Availability Tester' });
    userId = user.id;
    userEmail = user.email;
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  beforeEach(() => {
    clearCookieJar();
  });

  it('storefront listing marks a supplier out-of-stock product as not purchasable', async () => {
    const listed = await listStorefrontProducts({ q: 'Itest Supplier Sold Out', perPage: 48 });
    const card = listed.items.find((i) => i.id === outOfStockProductId);
    expect(card).toBeDefined();
    expect(card!.availability.state).toBe('OUT_OF_STOCK');
    expect(card!.availability.purchasable).toBe(false);
    // The merchant counter (99) must not leak into the public stock figure.
    expect(card!.stock).toBe(0);
  });

  it('product page agrees with the listing', async () => {
    const product = await getStorefrontProduct(outOfStockSlug);
    expect(product).not.toBeNull();
    const availability = availabilityOf(product!);
    expect(availability.state).toBe('OUT_OF_STOCK');
    expect(availability.supplierVerified).toBe(true);
  });

  it('cart refuses to add a supplier-verified out-of-stock product', async () => {
    await expect(addToCart({ productId: outOfStockProductId, quantity: 1 })).rejects.toThrow(
      /out of stock/i
    );
    const view = await getCartView(null);
    expect(view.isEmpty).toBe(true);
  });

  it('allows a fresh in-stock supplier product and caps the line at the reported quantity', async () => {
    // The supplier reports only two units left: the cart must not accept more,
    // even though the merchant counter is irrelevant here.
    await prisma.supplierProduct.update({
      where: { productId: inStockProductId },
      data: { inStock: true, stockQty: 2, lastSyncedAt: FRESH() },
    });

    const view = await addToCart({ productId: inStockProductId, quantity: 2 });
    expect(view.isEmpty).toBe(false);
    expect(view.lines[0].quantity).toBe(2);

    await expect(addToCart({ productId: inStockProductId, quantity: 5 })).rejects.toThrow(
      /only 2 unit/i
    );

    await prisma.supplierProduct.update({
      where: { productId: inStockProductId },
      data: { inStock: true, stockQty: 40, lastSyncedAt: FRESH() },
    });
  });

  it('checkout refuses when the supplier flips to out of stock after the item was added', async () => {
    // Customer adds while the supplier still reports stock…
    const view = await addToCart({ productId: inStockProductId, quantity: 1 });
    expect(view.isEmpty).toBe(false);

    // …then the next catalog sync reports the item is gone.
    await prisma.supplierProduct.update({
      where: { productId: inStockProductId },
      data: { inStock: false, stockQty: 0, lastSyncedAt: FRESH() },
    });

    const items = await loadCartItems(view.cartId);
    expect(items).toHaveLength(1);
    expect(lineAvailable(items[0]).available).toBe(false);

    await expect(
      createOrderFromCart({
        cartId: view.cartId,
        user: {
          id: userId,
          email: userEmail,
          name: 'Availability Tester',
          role: 'CUSTOMER',
          status: 'ACTIVE',
        },
        address: TEST_ADDRESS,
        paymentMethod: 'PREPAID_GATEWAY',
        idempotencyKey: unique('itest-avail'),
      })
    ).rejects.toThrow(/no longer available/i);

    // No order may exist: the customer was never charged for stock that is gone.
    const orders = await prisma.order.count({ where: { userId } });
    expect(orders).toBe(0);

    // restore for later tests
    await prisma.supplierProduct.update({
      where: { productId: inStockProductId },
      data: { inStock: true, stockQty: 40, lastSyncedAt: FRESH() },
    });
  });

  it('does not claim stock (or fabricate scarcity) when the supplier report is stale', async () => {
    const listed = await listStorefrontProducts({ q: 'Itest Supplier Stale', perPage: 48 });
    const card = listed.items.find((i) => i.id === staleProductId);
    expect(card).toBeDefined();
    expect(card!.availability.state).toBe('UNVERIFIED');
    expect(card!.availability.purchasable).toBe(true);
    expect(card!.availability.label.toLowerCase()).not.toContain('in stock');

    // An unverified item stays orderable — the supplier is re-checked at
    // fulfilment, and blocking here would silently kill legitimate sales.
    const view = await addToCart({ productId: staleProductId, quantity: 1 });
    expect(view.isEmpty).toBe(false);
  });

  it('"in stock only" filtering never uses the merchant counter for supplier products', async () => {
    const filtered = await listStorefrontProducts({ inStockOnly: true, perPage: 48 });
    const ids = filtered.items.map((i) => i.id);
    // Merchant counter says 99, supplier says zero → must be excluded.
    expect(ids).not.toContain(outOfStockProductId);
    // Fresh, positively in stock → included.
    expect(ids).toContain(inStockProductId);
    // Stale data → not advertised as in stock.
    expect(ids).not.toContain(staleProductId);
  });
});
