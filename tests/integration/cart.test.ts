import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import {
  addToCart,
  updateCartItemQuantity,
  removeCartItem,
  applyCouponToCart,
  getCartView,
  getCartItemCount,
} from '@/lib/cart/service';
import { ApiError } from '@/lib/errors';
import { clearCookieJar } from './mock-headers';
import { cleanupTestData, createTestProduct, createTestCoupon } from './fixtures';

describe('cart service (stock-aware, price-at-add snapshots)', () => {
  let plainProductId: string;
  let variantProductId: string;
  let redVariantId: string;
  let blueVariantId: string;

  beforeAll(async () => {
    await cleanupTestData();
    const plain = await createTestProduct({
      name: 'Itest Plain',
      stock: 5,
      sellingPrice: '250.00',
    });
    plainProductId = plain.id;
    const variantProduct = await createTestProduct({
      name: 'Itest Variant',
      hasVariants: true,
      variants: [
        { name: 'Red', stock: 2, sellingPrice: '300.00' },
        { name: 'Blue', stock: 0, sellingPrice: '300.00' },
      ],
    });
    variantProductId = variantProduct.id;
    redVariantId = variantProduct.variants.find((v) => v.name === 'Red')!.id;
    blueVariantId = variantProduct.variants.find((v) => v.name === 'Blue')!.id;
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  beforeEach(() => {
    clearCookieJar(); // every test starts with a fresh guest cart
  });

  it('adds items and computes subtotals in integer paise', async () => {
    const view = await addToCart({ productId: plainProductId, quantity: 2 });
    expect(view.isEmpty).toBe(false);
    expect(view.itemCount).toBe(2);
    expect(view.subtotalPaise).toBe(50_000); // 2 × ₹250
    expect(view.lines[0].unitPricePaise).toBe(25_000);
    expect(view.lines[0].lineTotalPaise).toBe(50_000);
  });

  it('merges repeated adds into one line', async () => {
    await addToCart({ productId: plainProductId, quantity: 2 });
    const view = await addToCart({ productId: plainProductId, quantity: 1 });
    expect(view.lines).toHaveLength(1);
    expect(view.itemCount).toBe(3);
  });

  it('enforces LOCAL stock limits at add time', async () => {
    await addToCart({ productId: plainProductId, quantity: 5 });
    try {
      await addToCart({ productId: plainProductId, quantity: 1 });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).statusCode).toBe(400);
    }
  });

  it('rejects out-of-stock adds', async () => {
    const soldOut = await createTestProduct({ name: 'Itest SoldOut', stock: 0 });
    await expect(addToCart({ productId: soldOut.id, quantity: 1 })).rejects.toThrow(
      /out of stock/i
    );
  });

  it('requires a variant choice for variant products and honours variant stock', async () => {
    await expect(addToCart({ productId: variantProductId, quantity: 1 })).rejects.toThrow(
      /select options/i
    );

    const view = await addToCart({
      productId: variantProductId,
      variantId: redVariantId,
      quantity: 2,
    });
    expect(view.lines[0].variantName).toBe('Red');
    expect(view.lines[0].unitPricePaise).toBe(30_000); // variant price overrides product price
    expect(view.subtotalPaise).toBe(60_000);

    await expect(
      addToCart({ productId: variantProductId, variantId: redVariantId, quantity: 1 })
    ).rejects.toThrow(/available/i);

    await expect(
      addToCart({ productId: variantProductId, variantId: blueVariantId, quantity: 1 })
    ).rejects.toThrow(/out of stock/i);
  });

  it('updates and removes lines', async () => {
    const view = await addToCart({ productId: plainProductId, quantity: 3 });
    const itemId = view.lines[0].itemId;

    const updated = await updateCartItemQuantity({ itemId, quantity: 1 });
    expect(updated.itemCount).toBe(1);
    expect(updated.subtotalPaise).toBe(25_000);

    const removed = await removeCartItem({ itemId });
    expect(removed.isEmpty).toBe(true);
    expect(await getCartItemCount()).toBe(0);
  });

  it('applies a valid coupon and rejects an invalid one', async () => {
    const coupon = await createTestCoupon({ type: 'PERCENT', value: '10' });
    await addToCart({ productId: plainProductId, quantity: 2 }); // ₹500

    const view = await applyCouponToCart({ code: coupon.code.toLowerCase() });
    expect(view.coupon?.code).toBe(coupon.code);
    expect(view.coupon?.discountPaise).toBe(5_000); // 10% of ₹500
    expect(view.grandTotalPaise).toBe(view.subtotalPaise - 5_000 + view.shippingPaise);

    await expect(applyCouponToCart({ code: 'ITESTNOPE' })).rejects.toThrow();
  });

  it('enforces coupon minimum order amounts', async () => {
    const coupon = await createTestCoupon({ type: 'FIXED', value: '100', minOrderAmount: '9999' });
    await addToCart({ productId: plainProductId, quantity: 1 }); // ₹250 < ₹9999
    await expect(applyCouponToCart({ code: coupon.code })).rejects.toThrow();
  });

  it('getCartView stays internally consistent (grand = subtotal − discount + shipping)', async () => {
    await addToCart({ productId: plainProductId, quantity: 4 }); // ₹1000
    const view = await getCartView();
    expect(view.subtotalPaise).toBe(100_000);
    expect(view.freeShippingApplied).toBe(view.subtotalPaise >= view.freeShippingThresholdPaise);
    expect(view.grandTotalPaise).toBe(
      view.subtotalPaise - (view.coupon?.discountPaise ?? 0) + view.shippingPaise
    );
  });

  it('carts are persisted in the database (not just cookies)', async () => {
    await addToCart({ productId: plainProductId, quantity: 1 });
    const carts = await prisma.cart.count({
      where: { items: { some: { productId: plainProductId } } },
    });
    expect(carts).toBeGreaterThanOrEqual(1);
  });
});
