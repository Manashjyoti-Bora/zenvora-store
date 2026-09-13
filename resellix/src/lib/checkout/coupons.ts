import { prisma } from '../db';
import { toPaise, percentOfPaise } from '../money';
import { getSettings } from '../settings';
import { validateMinimumMargin } from '../pricing/calculations';

/**
 * Coupon validation & discount calculation.
 *
 * Abuse protections:
 * - All checks run server-side at BOTH apply-time (UX) and order-creation
 *   time (authoritative, inside the transaction).
 * - Global usage limit is enforced with a conditional atomic increment.
 * - Per-user limit counts CouponRedemption rows (by userId or guest email).
 * - Amount caps: minOrderAmount, maxDiscountAmount.
 * - Time windows: startsAt / endsAt.
 */

export interface CouponEvalInput {
  code: string;
  subtotalPaise: number;
  /** Subtotal of lines the coupon applies to (scope-aware). */
  eligiblePaise: number;
  /** Landed cost of the eligible lines - required for margin protection. */
  totalCostPaise?: number;
  userId?: string | null;
  guestEmail?: string | null;
}

export type CouponEvalResult =
  | { ok: true; couponId: string; code: string; discountPaise: number; description: string | null }
  | { ok: false; reason: string };

export async function evaluateCoupon(input: CouponEvalInput): Promise<CouponEvalResult> {
  const code = input.code.trim().toUpperCase();
  if (!code) return { ok: false, reason: 'Enter a coupon code.' };

  const coupon = await prisma.coupon.findUnique({ where: { code } });
  if (!coupon) return { ok: false, reason: 'This coupon code is not valid.' };
  if (!coupon.isActive) return { ok: false, reason: 'This coupon is no longer active.' };

  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now)
    return { ok: false, reason: 'This coupon is not active yet.' };
  if (coupon.endsAt && coupon.endsAt < now)
    return { ok: false, reason: 'This coupon has expired.' };

  if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) {
    return { ok: false, reason: 'This coupon has reached its usage limit.' };
  }

  if (input.userId || input.guestEmail) {
    const used = await prisma.couponRedemption.count({
      where: {
        couponCode: code,
        ...(input.userId ? { userId: input.userId } : { guestEmail: input.guestEmail! }),
      },
    });
    if (used >= coupon.perUserLimit) {
      return { ok: false, reason: 'You have already used this coupon.' };
    }
  }

  if (coupon.firstOrderOnly) {
    if (!input.userId) {
      return { ok: false, reason: 'This first-order coupon requires you to be signed in.' };
    }
    // Only non-cancelled orders consume "first order" status.
    const priorOrders = await prisma.order.count({
      where: { userId: input.userId, status: { notIn: ['CANCELLED'] } },
    });
    if (priorOrders > 0) {
      return { ok: false, reason: 'This coupon is valid only on your first order.' };
    }
  }

  if (coupon.minOrderAmount !== null && input.subtotalPaise < toPaise(coupon.minOrderAmount)) {
    const min = toPaise(coupon.minOrderAmount) / 100;
    return { ok: false, reason: `This coupon requires a minimum order of ₹${min}.` };
  }

  let discountPaise = 0;
  if (coupon.type === 'PERCENT') {
    discountPaise = percentOfPaise(input.eligiblePaise, Number(coupon.value));
  } else {
    discountPaise = Math.min(toPaise(coupon.value), input.eligiblePaise);
  }
  if (coupon.maxDiscountAmount !== null) {
    discountPaise = Math.min(discountPaise, toPaise(coupon.maxDiscountAmount));
  }
  if (discountPaise <= 0) return { ok: false, reason: 'This coupon does not apply to your cart.' };

  // Minimum-margin protection: the discounted subtotal must not fall below
  // the store's margin floor unless this coupon explicitly bypasses it.
  const settings = await getSettings();
  const gate = validateMinimumMargin({
    subtotalPaise: input.subtotalPaise,
    totalCostPaise: input.totalCostPaise ?? 0,
    requestedDiscountPaise: discountPaise,
    bypass: coupon.bypassMarginProtection,
    settings,
  });
  if (gate.capped) {
    if (gate.allowedDiscountPaise <= 0) {
      return {
        ok: false,
        reason: 'This coupon would push the order below the store minimum margin and cannot apply.',
      };
    }
    discountPaise = gate.allowedDiscountPaise;
  }

  return { ok: true, couponId: coupon.code, code, discountPaise, description: coupon.description };
}
