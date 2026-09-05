import { cookies } from 'next/headers';
import { prisma } from '../db';
import { badRequest, notFound } from '../errors';
import { toPaise, formatINR } from '../money';
import { getSettings } from '../settings';
import { calcShipping, calcTotals, type CheckoutLine } from '../checkout/calc';
import { evaluateCoupon } from '../checkout/coupons';
import { prorateDiscount } from '../pricing/engine';
import { randomToken } from '../crypto';
import type { Cart } from '@prisma/client';

/**
 * Server-side cart (persisted in PostgreSQL; identified by an httpOnly
 * cookie token for guests, or by userId once logged in).
 *
 * Prices shown in the cart are always re-read from the database - the client
 * never supplies prices, which makes price manipulation impossible.
 */

export const CART_COOKIE = 'resellix_cart';
const CART_TTL_DAYS = 30;
const MAX_QTY_PER_LINE = 20;

export interface CartLineView {
  itemId: string;
  productId: string;
  variantId: string | null;
  name: string;
  slug: string;
  variantName: string | null;
  image: string | null;
  unitPricePaise: number;
  quantity: number;
  lineTotalPaise: number;
  available: boolean;
  maxQuantity: number;
}

export interface CartView {
  cartId: string;
  lines: CartLineView[];
  itemCount: number;
  subtotalPaise: number;
  coupon: { code: string; discountPaise: number } | null;
  couponError: string | null;
  shippingPaise: number;
  freeShippingApplied: boolean;
  freeShippingThresholdPaise: number;
  grandTotalPaise: number;
  isEmpty: boolean;
}

export async function getOrCreateCart(userId?: string | null): Promise<Cart> {
  const cookieStore = await cookies();

  if (userId) {
    let userCart = await prisma.cart.findUnique({ where: { userId } });
    if (userCart && userCart.convertedOrderId) {
      // Previous cart became an order: detach it (kept for history) and start fresh.
      await prisma.cart.update({ where: { id: userCart.id }, data: { userId: null } });
      userCart = null;
    }
    if (userCart) return userCart;
    // First authenticated action: create the user cart and merge any guest cart.
    const guestToken = cookieStore.get(CART_COOKIE)?.value ?? null;
    const cart = await prisma.cart.create({
      data: { userId, guestToken: null, expiresAt: cartExpiry() },
    });
    if (guestToken) await mergeGuestCart(guestToken, cart.id);
    cookieStore.delete(CART_COOKIE);
    return cart;
  }

  const guestToken = cookieStore.get(CART_COOKIE)?.value;
  if (guestToken) {
    const cart = await prisma.cart.findUnique({ where: { guestToken } });
    if (cart && !cart.convertedOrderId) return cart;
  }
  const token = randomToken(24);
  const cart = await prisma.cart.create({
    data: { guestToken: token, expiresAt: cartExpiry() },
  });
  cookieStore.set(CART_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: CART_TTL_DAYS * 86400,
  });
  return cart;
}

function cartExpiry(): Date {
  return new Date(Date.now() + CART_TTL_DAYS * 86400e3);
}

async function mergeGuestCart(guestToken: string, targetCartId: string): Promise<void> {
  const guestCart = await prisma.cart.findUnique({
    where: { guestToken },
    include: { items: true },
  });
  if (!guestCart || guestCart.id === targetCartId) return;
  for (const item of guestCart.items) {
    const existing = await prisma.cartItem.findFirst({
      where: { cartId: targetCartId, productId: item.productId, variantId: item.variantId },
    });
    if (existing) {
      await prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: Math.min(existing.quantity + item.quantity, MAX_QTY_PER_LINE) },
      });
    } else {
      await prisma.cartItem.create({
        data: {
          cartId: targetCartId,
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          unitPriceAtAdd: item.unitPriceAtAdd,
        },
      });
    }
  }
  await prisma.cart.delete({ where: { id: guestCart.id } });
}

/** Attach a guest cart to a user right after login/registration. */
export async function attachGuestCartToUser(userId: string): Promise<void> {
  const cookieStore = await cookies();
  const guestToken = cookieStore.get(CART_COOKIE)?.value;
  if (!guestToken) return;
  const userCart = await prisma.cart.findUnique({ where: { userId } });
  if (userCart) {
    await mergeGuestCart(guestToken, userCart.id);
  } else {
    await prisma.cart.updateMany({
      where: { guestToken },
      data: { userId, guestToken: null },
    });
  }
  cookieStore.delete(CART_COOKIE);
}

export async function loadCartItems(cartId: string) {
  return prisma.cartItem.findMany({
    where: { cartId },
    include: {
      product: {
        include: {
          images: { orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }], take: 1 },
        },
      },
      variant: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}

export type CartItemWithProduct = Awaited<ReturnType<typeof loadCartItems>>[number];

export function unitPricePaiseOf(item: CartItemWithProduct): number {
  if (item.variant?.sellingPrice != null) return toPaise(item.variant.sellingPrice);
  return toPaise(item.product.sellingPrice);
}

export function lineAvailable(item: CartItemWithProduct): {
  available: boolean;
  maxQuantity: number;
} {
  if (item.product.status !== 'ACTIVE') return { available: false, maxQuantity: 0 };
  if (item.variant && !item.variant.isActive) return { available: false, maxQuantity: 0 };
  if (item.product.stockMode === 'LOCAL') {
    const stock = item.variant ? item.variant.stock : item.product.stock;
    if (stock <= 0) return { available: false, maxQuantity: 0 };
    return { available: true, maxQuantity: Math.min(stock, MAX_QTY_PER_LINE) };
  }
  return { available: true, maxQuantity: MAX_QTY_PER_LINE };
}

export async function addToCart(params: {
  userId?: string | null;
  productId: string;
  variantId?: string | null;
  quantity: number;
}): Promise<CartView> {
  const cart = await getOrCreateCart(params.userId);
  const product = await prisma.product.findUnique({
    where: { id: params.productId },
    include: { variants: true },
  });
  if (!product || product.status !== 'ACTIVE') throw notFound('Product not available');

  let variant = null;
  if (params.variantId) {
    variant = product.variants.find((v) => v.id === params.variantId) ?? null;
    if (!variant || !variant.isActive) throw badRequest('Selected variant is not available');
  } else if (product.hasVariants) {
    throw badRequest('Please select options for this product');
  }

  const existing = await prisma.cartItem.findFirst({
    where: { cartId: cart.id, productId: product.id, variantId: variant?.id ?? null },
  });
  const newQty = Math.min((existing?.quantity ?? 0) + params.quantity, MAX_QTY_PER_LINE);

  if (product.stockMode === 'LOCAL') {
    const stock = variant ? variant.stock : product.stock;
    if (newQty > stock) {
      throw badRequest(
        stock <= 0 ? 'This product is out of stock' : `Only ${stock} unit(s) available`
      );
    }
  }

  const unitPrice =
    variant?.sellingPrice != null ? toPaise(variant.sellingPrice) : toPaise(product.sellingPrice);
  if (existing) {
    await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: newQty, unitPriceAtAdd: unitPrice / 100 },
    });
  } else {
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId: product.id,
        variantId: variant?.id ?? null,
        quantity: params.quantity,
        unitPriceAtAdd: unitPrice / 100,
      },
    });
  }
  return getCartView(params.userId ?? null);
}

export async function updateCartItemQuantity(params: {
  userId?: string | null;
  itemId: string;
  quantity: number;
}): Promise<CartView> {
  const cart = await getOrCreateCart(params.userId);
  const item = await prisma.cartItem.findFirst({
    where: { id: params.itemId, cartId: cart.id },
    include: { product: true, variant: true },
  });
  if (!item) throw notFound('Cart item not found');

  if (item.product.stockMode === 'LOCAL') {
    const stock = item.variant ? item.variant.stock : item.product.stock;
    if (params.quantity > stock) throw badRequest(`Only ${stock} unit(s) available`);
  }
  await prisma.cartItem.update({
    where: { id: item.id },
    data: { quantity: Math.min(params.quantity, MAX_QTY_PER_LINE) },
  });
  return getCartView(params.userId ?? null);
}

export async function removeCartItem(params: {
  userId?: string | null;
  itemId: string;
}): Promise<CartView> {
  const cart = await getOrCreateCart(params.userId);
  const res = await prisma.cartItem.deleteMany({ where: { id: params.itemId, cartId: cart.id } });
  if (res.count === 0) throw notFound('Cart item not found');
  return getCartView(params.userId ?? null);
}

export async function applyCouponToCart(params: {
  userId?: string | null;
  code: string;
  guestEmail?: string | null;
}): Promise<CartView> {
  const cart = await getOrCreateCart(params.userId);
  // Validate now for fast feedback; checkout re-validates authoritatively.
  const items = await loadCartItems(cart.id);
  const subtotal = items.reduce((a, i) => a + unitPricePaiseOf(i) * i.quantity, 0);
  const result = await evaluateCoupon({
    code: params.code,
    subtotalPaise: subtotal,
    eligiblePaise: subtotal, // scope filtering re-checked at order creation
    userId: params.userId ?? null,
    guestEmail: params.guestEmail ?? null,
  });
  if (!result.ok) throw badRequest(result.reason);
  await prisma.cart.update({ where: { id: cart.id }, data: { couponCode: result.code } });
  return getCartView(params.userId ?? null);
}

export async function removeCouponFromCart(userId?: string | null): Promise<CartView> {
  const cart = await getOrCreateCart(userId);
  await prisma.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
  return getCartView(userId ?? null);
}

export async function getCartView(
  userId?: string | null,
  opts?: { guestEmail?: string | null; paymentMethod?: 'PREPAID_GATEWAY' | 'COD' }
): Promise<CartView> {
  const cart = await getOrCreateCart(userId);
  return renderCartView(cart, userId ?? null, opts);
}

/**
 * READ-ONLY cart view for render-time callers (pages, layouts, header).
 *
 * Next.js 15 forbids modifying cookies while rendering a Server Component
 * ("Cookies can only be modified in a Server Action or Route Handler"), so
 * pages must never create a guest cart. This variant:
 *  - resolves an existing cart (user cart, or guest cart by cookie) WITHOUT
 *    creating anything,
 *  - returns an empty-cart view when none exists.
 * Cart creation stays exclusively in route handlers (POST /api/cart etc.),
 * where setting the guest cookie is legal.
 */
export async function getCartViewReadOnly(
  userId?: string | null,
  opts?: { guestEmail?: string | null; paymentMethod?: 'PREPAID_GATEWAY' | 'COD' }
): Promise<CartView> {
  const cookieStore = await cookies(); // reading cookies during render is allowed
  let cart: Cart | null = null;
  if (userId) {
    const userCart = await prisma.cart.findUnique({ where: { userId } });
    if (userCart && !userCart.convertedOrderId) cart = userCart;
  } else {
    const guestToken = cookieStore.get(CART_COOKIE)?.value;
    if (guestToken) {
      const guestCart = await prisma.cart.findUnique({ where: { guestToken } });
      if (guestCart && !guestCart.convertedOrderId) cart = guestCart;
    }
  }
  if (!cart) return emptyCartView();
  return renderCartView(cart, userId ?? null, opts);
}

async function emptyCartView(): Promise<CartView> {
  const settings = await getSettings();
  return {
    cartId: '',
    lines: [],
    itemCount: 0,
    subtotalPaise: 0,
    coupon: null,
    couponError: null,
    shippingPaise: 0,
    freeShippingApplied: false,
    freeShippingThresholdPaise: settings.shipping.freeAbovePaise,
    grandTotalPaise: 0,
    isEmpty: true,
  };
}

async function renderCartView(
  cart: Cart,
  userId: string | null,
  opts?: { guestEmail?: string | null; paymentMethod?: 'PREPAID_GATEWAY' | 'COD' }
): Promise<CartView> {
  const items = await loadCartItems(cart.id);
  const settings = await getSettings();

  const lines: CartLineView[] = items.map((item) => {
    const unitPricePaise = unitPricePaiseOf(item);
    const { available, maxQuantity } = lineAvailable(item);
    const primaryImage = item.product.images[0]?.url ?? null;
    return {
      itemId: item.id,
      productId: item.productId,
      variantId: item.variantId,
      name: item.product.name,
      slug: item.product.slug,
      variantName: item.variant?.name ?? null,
      image: primaryImage,
      unitPricePaise,
      quantity: item.quantity,
      lineTotalPaise: unitPricePaise * item.quantity,
      available,
      maxQuantity,
    };
  });

  const subtotalPaise = lines.reduce((a, l) => a + l.lineTotalPaise, 0);

  let couponView: CartView['coupon'] = null;
  let couponError: string | null = null;
  let discountPaise = 0;
  if (cart.couponCode) {
    const result = await evaluateCoupon({
      code: cart.couponCode,
      subtotalPaise,
      eligiblePaise: subtotalPaise,
      userId: userId ?? null,
      guestEmail: opts?.guestEmail ?? null,
    });
    if (result.ok) {
      couponView = { code: result.code, discountPaise: result.discountPaise };
      discountPaise = result.discountPaise;
    } else {
      couponError = result.reason;
    }
  }

  const paymentMethod = opts?.paymentMethod ?? 'PREPAID_GATEWAY';
  const shipping = calcShipping(subtotalPaise - discountPaise, settings, paymentMethod);
  const checkoutLines: CheckoutLine[] = items.map((item, i) => ({
    key: String(i),
    unitPricePaise: lines[i].unitPricePaise,
    quantity: item.quantity,
    taxRatePercent: Number(item.variant?.taxRatePercent ?? item.product.taxRatePercent),
    unitLandedCostPaise: 0,
  }));
  const totals = calcTotals({
    lines: checkoutLines,
    discountTotalPaise: discountPaise,
    shipping,
    lineDiscountsPaise: prorateDiscount(
      checkoutLines.map((l) => l.unitPricePaise * l.quantity),
      discountPaise
    ),
  });

  return {
    cartId: cart.id,
    lines,
    itemCount: lines.reduce((a, l) => a + l.quantity, 0),
    subtotalPaise,
    coupon: couponView,
    couponError,
    shippingPaise: totals.shippingPaise + totals.codFeePaise,
    freeShippingApplied: shipping.freeShippingApplied,
    freeShippingThresholdPaise: settings.shipping.freeAbovePaise,
    grandTotalPaise: totals.grandTotalPaise,
    isEmpty: lines.length === 0,
  };
}

export async function getCartItemCount(userId?: string | null): Promise<number> {
  try {
    // Read-only: the header renders on every page, so it must never create a
    // guest cart or write cookies during render.
    const view = await getCartViewReadOnly(userId);
    return view.itemCount;
  } catch {
    return 0;
  }
}

export function formatPaise(paise: number): string {
  return formatINR(paise);
}

export type { Cart };
