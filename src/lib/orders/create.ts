import { prisma } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import { logger } from '../logger';
import { auditLog } from '../audit';
import { toPaise } from '../money';
import { getSettings } from '../settings';
import { generateOrderNumber } from '../crypto';
import { prorateDiscount } from '../pricing/engine';
import {
  calcShipping,
  calcTotals,
  estimatePaymentFeePaise,
  type CheckoutLine,
} from '../checkout/calc';
import { evaluateCoupon } from '../checkout/coupons';
import {
  loadCartItems,
  unitPricePaiseOf,
  lineAvailable,
  type CartItemWithProduct,
} from '../cart/service';
import type { SessionUser } from '../auth/session';
import type { Prisma } from '@prisma/client';

/**
 * Order creation from a cart.
 *
 * Guarantees:
 * - Prices/costs are re-read from the DB inside the transaction; client input
 *   NEVER determines money values (price manipulation impossible).
 * - Product & cost snapshots are frozen on order items (history is immutable
 *   against later catalog changes).
 * - LOCAL-mode stock is decremented atomically (conditional UPDATE); any
 *   failure rolls the whole order back.
 * - Idempotent: same idempotencyKey or an already-converted cart returns the
 *   existing order instead of creating a duplicate.
 * - Coupon usage limits enforced atomically via conditional SQL increment.
 */

export interface GuestInfo {
  email: string;
  name: string;
  phone: string;
}

export interface AddressInput {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface CreateOrderInput {
  cartId: string;
  user?: SessionUser | null;
  guest?: GuestInfo | null;
  address: AddressInput;
  paymentMethod: 'PREPAID_GATEWAY' | 'COD';
  couponCode?: string | null;
  customerNote?: string | null;
  idempotencyKey?: string | null;
  req?: Request;
}

export interface CreateOrderResult {
  orderId: string;
  orderNumber: string;
  grandTotalPaise: number;
  paymentMethod: 'PREPAID_GATEWAY' | 'COD';
  alreadyExisted: boolean;
  status: string;
}

/** Prisma accepts decimal strings - avoids float rounding entirely. */
function dec(paise: number): string {
  return (paise / 100).toFixed(2);
}

export async function createOrderFromCart(input: CreateOrderInput): Promise<CreateOrderResult> {
  const settings = await getSettings();

  if (input.paymentMethod === 'COD' && !settings.shipping.codEnabled) {
    throw badRequest('Cash on Delivery is not available for this store right now.');
  }
  if (!input.user && !input.guest) {
    throw badRequest('Guest details are required for guest checkout.');
  }

  // --- Idempotency: repeated identical checkout returns the same order -----
  if (input.idempotencyKey) {
    const existingByKey = await prisma.order.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existingByKey) return existingToResult(existingByKey, true);
  }
  const existingCart = await prisma.cart.findUnique({ where: { id: input.cartId } });
  if (!existingCart) throw notFound('Cart not found. Please add items again.');
  if (existingCart.convertedOrderId) {
    const existing = await prisma.order.findUnique({
      where: { id: existingCart.convertedOrderId },
    });
    if (existing) return existingToResult(existing, true);
  }

  // --- Load & validate ------------------------------------------------------
  const items = await loadCartItems(input.cartId);
  if (items.length === 0) throw badRequest('Your cart is empty.');
  for (const item of items) {
    const { available } = lineAvailable(item);
    if (!available) {
      throw conflict(
        `"${item.product.name}" is no longer available. Please remove it from your cart and try again.`,
        { productId: item.productId }
      );
    }
  }

  // --- Build authoritative lines -------------------------------------------
  const lines = items.map((item) => buildLine(item));
  const subtotalPaise = lines.reduce((a, l) => a + l.unitPricePaise * l.quantity, 0);

  // --- Coupon ----------------------------------------------------------------
  let discountPaise = 0;
  let couponCode: string | null = null;
  const requestedCoupon = (input.couponCode ?? existingCart.couponCode ?? '').trim().toUpperCase();
  if (requestedCoupon) {
    const couponRecord = await prisma.coupon.findUnique({ where: { code: requestedCoupon } });
    const eligiblePaise =
      couponRecord?.scope === 'CATEGORY'
        ? lines
            .filter((l) => l.categoryId === couponRecord.categoryId)
            .reduce((a, l) => a + l.unitPricePaise * l.quantity, 0)
        : subtotalPaise;
    const evaluation = await evaluateCoupon({
      code: requestedCoupon,
      subtotalPaise,
      eligiblePaise,
      userId: input.user?.id ?? null,
      guestEmail: input.guest?.email ?? null,
    });
    if (!evaluation.ok) throw badRequest(evaluation.reason);
    discountPaise = evaluation.discountPaise;
    couponCode = evaluation.code;
  }

  // --- Shipping & totals ------------------------------------------------------
  const shipping = calcShipping(subtotalPaise - discountPaise, settings, input.paymentMethod);
  const checkoutLines: CheckoutLine[] = lines.map((l, i) => ({
    key: String(i),
    unitPricePaise: l.unitPricePaise,
    quantity: l.quantity,
    taxRatePercent: l.taxRatePercent,
    unitLandedCostPaise: l.unitLandedCostPaise,
  }));
  const lineDiscounts = prorateDiscount(
    lines.map((l) => l.unitPricePaise * l.quantity),
    discountPaise
  );
  const totals = calcTotals({
    lines: checkoutLines,
    discountTotalPaise: discountPaise,
    shipping,
    lineDiscountsPaise: lineDiscounts,
  });

  const estimatedFeePaise =
    input.paymentMethod === 'PREPAID_GATEWAY'
      ? estimatePaymentFeePaise(totals.grandTotalPaise, settings)
      : 0;
  const estimatedProfitPaise =
    totals.subtotalPaise -
    totals.discountTotalPaise +
    totals.shippingPaise +
    totals.codFeePaise -
    totals.supplierCostTotalPaise -
    estimatedFeePaise;

  const guestEmail = input.user ? null : input.guest!.email.toLowerCase();
  const addressSnapshot = {
    fullName: input.address.fullName,
    phone: input.address.phone,
    line1: input.address.line1,
    line2: input.address.line2 ?? null,
    city: input.address.city,
    state: input.address.state,
    postalCode: input.address.postalCode,
    country: input.address.country,
  } as unknown as Prisma.InputJsonValue;

  // --- Persist (with retries for order-number collisions) ----------------------
  for (let attempt = 0; attempt < 4; attempt++) {
    const orderNumber = generateOrderNumber();
    try {
      const orderId = await prisma.$transaction(async (tx) => {
        // 1) Reserve LOCAL-mode stock atomically.
        for (const line of lines) {
          if (line.stockMode !== 'LOCAL') continue;
          const res = line.variantId
            ? await tx.productVariant.updateMany({
                where: { id: line.variantId, stock: { gte: line.quantity } },
                data: { stock: { decrement: line.quantity } },
              })
            : await tx.product.updateMany({
                where: { id: line.productId, stock: { gte: line.quantity } },
                data: { stock: { decrement: line.quantity } },
              });
          if (res.count === 0) {
            throw conflict(`"${line.name}" just went out of stock. Please adjust your cart.`);
          }
        }

        // 2) Coupon usage: atomic conditional increment (abuse-proof).
        if (couponCode) {
          const updated = await tx.$queryRaw<Array<{ code: string }>>`
            UPDATE coupons SET "usageCount" = "usageCount" + 1
            WHERE code = ${couponCode} AND "isActive" = true
              AND ("usageLimit" IS NULL OR "usageCount" < "usageLimit")
            RETURNING code`;
          if (updated.length === 0) {
            throw conflict('This coupon just reached its usage limit.');
          }
        }

        // 3) Order + items + snapshots.
        const order = await tx.order.create({
          data: {
            orderNumber,
            idempotencyKey: input.idempotencyKey ?? null,
            userId: input.user?.id ?? null,
            guestEmail,
            guestName: input.user ? null : input.guest!.name,
            guestPhone: input.user ? null : input.guest!.phone,
            status: 'PENDING_PAYMENT',
            paymentStatus: 'PENDING',
            fulfilmentStatus: 'PENDING',
            paymentMethod: input.paymentMethod,
            currency: 'INR',
            subtotal: dec(totals.subtotalPaise),
            discountTotal: dec(totals.discountTotalPaise),
            shippingTotal: dec(totals.shippingPaise),
            codFeeTotal: dec(totals.codFeePaise),
            taxTotal: dec(totals.taxTotalPaise),
            grandTotal: dec(totals.grandTotalPaise),
            supplierCostTotal: dec(totals.supplierCostTotalPaise),
            estimatedProfit: dec(estimatedProfitPaise),
            shippingAddress: addressSnapshot,
            couponCode,
            customerNote: input.customerNote ?? null,
            placedAt: new Date(),
            items: {
              create: lines.map((line, i) => ({
                productId: line.productId,
                variantId: line.variantId,
                productSnapshot: line.snapshot,
                sku: line.sku,
                supplierId: line.supplierId,
                supplierSku: line.supplierSku,
                quantity: line.quantity,
                unitPrice: dec(line.unitPricePaise),
                unitSupplierCost: dec(line.unitSupplierCostPaise),
                unitSupplierShipping: dec(line.unitSupplierShippingPaise),
                unitOtherCost: dec(line.unitOtherCostPaise),
                taxRatePercent: line.taxRatePercent,
                lineTotal: dec(totals.lineTotalsPaise[i]),
                lineDiscount: dec(totals.lineDiscountsPaise[i]),
                lineTax: dec(totals.lineTaxesPaise[i]),
                lineSupplierCost: dec(line.unitLandedCostPaise * line.quantity),
                lineEstimatedProfit: dec(
                  totals.lineTotalsPaise[i] -
                    totals.lineDiscountsPaise[i] -
                    line.unitLandedCostPaise * line.quantity
                ),
              })),
            },
            events: {
              create: {
                type: 'ORDER_PLACED',
                message:
                  input.paymentMethod === 'COD'
                    ? 'Order placed (Cash on Delivery)'
                    : 'Order placed (prepaid - awaiting payment)',
                actorType: 'CUSTOMER',
                actorId: input.user?.id ?? null,
              },
            },
          },
        });

        if (couponCode) {
          await tx.couponRedemption.create({
            data: {
              couponCode,
              userId: input.user?.id ?? null,
              guestEmail,
              orderId: order.id,
              amount: dec(discountPaise),
            },
          });
        }

        // 4) Mark cart converted (duplicate-order guard).
        await tx.cart.update({
          where: { id: input.cartId },
          data: { convertedOrderId: order.id, couponCode: null },
        });

        return order.id;
      });

      await auditLog({
        actor: input.user
          ? { id: input.user.id, email: input.user.email }
          : { email: guestEmail ?? undefined },
        action: 'order.placed',
        entityType: 'Order',
        entityId: orderId,
        data: {
          orderNumber,
          grandTotalPaise: totals.grandTotalPaise,
          paymentMethod: input.paymentMethod,
        },
        req: input.req,
      });
      logger.info('Order created', { orderId, orderNumber, total: totals.grandTotalPaise });

      return {
        orderId,
        orderNumber,
        grandTotalPaise: totals.grandTotalPaise,
        paymentMethod: input.paymentMethod,
        alreadyExisted: false,
        status: 'PENDING_PAYMENT',
      };
    } catch (err) {
      if (isUniqueViolation(err, 'orderNumber') && attempt < 3) continue;
      throw err;
    }
  }
  throw conflict('Could not create the order, please try again.');
}

function existingToResult(
  order: {
    id: string;
    orderNumber: string;
    grandTotal: Prisma.Decimal;
    paymentMethod: 'PREPAID_GATEWAY' | 'COD';
    status: string;
  },
  alreadyExisted: boolean
): CreateOrderResult {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    grandTotalPaise: toPaise(order.grandTotal),
    paymentMethod: order.paymentMethod,
    alreadyExisted,
    status: order.status,
  };
}

// ---------------------------------------------------------------------------

interface OrderLine {
  productId: string;
  variantId: string | null;
  name: string;
  sku: string | null;
  supplierId: string | null;
  supplierSku: string | null;
  categoryId: string | null;
  quantity: number;
  unitPricePaise: number;
  unitSupplierCostPaise: number;
  unitSupplierShippingPaise: number;
  unitOtherCostPaise: number;
  unitLandedCostPaise: number;
  taxRatePercent: number;
  stockMode: 'LOCAL' | 'SUPPLIER_SYNC';
  snapshot: Prisma.InputJsonValue;
}

function buildLine(item: CartItemWithProduct): OrderLine {
  const product = item.product;
  const variant = item.variant;
  const unitPricePaise = unitPricePaiseOf(item);
  if (unitPricePaise <= 0) {
    throw conflict(`"${product.name}" does not have a selling price yet. Please contact support.`);
  }
  const unitSupplierCostPaise = toPaise(variant?.supplierCost ?? product.supplierCost);
  const unitSupplierShippingPaise = toPaise(
    variant?.supplierShippingCost ?? product.supplierShippingCost
  );
  const unitOtherCostPaise = toPaise(product.otherCost);

  return {
    productId: product.id,
    variantId: variant?.id ?? null,
    name: product.name,
    sku: variant?.sku ?? product.sku ?? null,
    supplierId: product.supplierId,
    supplierSku: product.supplierSku,
    categoryId: product.categoryId,
    quantity: item.quantity,
    unitPricePaise,
    unitSupplierCostPaise,
    unitSupplierShippingPaise,
    unitOtherCostPaise,
    unitLandedCostPaise: unitSupplierCostPaise + unitSupplierShippingPaise + unitOtherCostPaise,
    taxRatePercent: Number(variant?.taxRatePercent ?? product.taxRatePercent),
    stockMode: product.stockMode as 'LOCAL' | 'SUPPLIER_SYNC',
    snapshot: {
      name: product.name,
      slug: product.slug,
      brand: product.brand ?? null,
      variantName: variant?.name ?? null,
      size: variant?.size ?? null,
      color: variant?.color ?? null,
      image: product.images?.[0]?.url ?? null,
    } as unknown as Prisma.InputJsonValue,
  };
}

function isUniqueViolation(err: unknown, field: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'P2002' &&
    JSON.stringify((err as { meta?: unknown }).meta ?? '').includes(field)
  );
}
