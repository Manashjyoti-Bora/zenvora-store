import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { evaluateCoupon } from '@/lib/checkout/coupons';

/**
 * First-order coupons: valid only for signed-in customers with no previous
 * non-cancelled orders. Guests are refused with a clear (non-leaky) reason.
 */

const CODE = `FIRST-${Date.now().toString(36).toUpperCase()}`;
const suffix = Date.now().toString(36);
let userWithOrder: string;
let freshUser: string;
let orderId: string;

beforeAll(async () => {
  await prisma.coupon.deleteMany({ where: { code: CODE } });
  await prisma.coupon.create({
    data: {
      code: CODE,
      description: 'first order test',
      type: 'PERCENT',
      value: '10',
      scope: 'ALL_PRODUCTS',
      isActive: true,
      firstOrderOnly: true,
    },
  });

  const a = await prisma.user.create({
    data: { email: `first-a-${suffix}@e2e.example`, passwordHash: 'x', name: 'A' },
  });
  const b = await prisma.user.create({
    data: { email: `first-b-${suffix}@e2e.example`, passwordHash: 'x', name: 'B' },
  });
  userWithOrder = a.id;
  freshUser = b.id;

  const order = await prisma.order.create({
    data: {
      orderNumber: `RX-FO-${suffix.toUpperCase()}`,
      userId: a.id,
      subtotal: '100.00',
      grandTotal: '100.00',
      shippingAddress: { city: 'Dibrugarh' },
      paymentMethod: 'COD',
      status: 'DELIVERED',
      paymentStatus: 'PAID',
    },
  });
  orderId = order.id;
});

afterAll(async () => {
  await prisma.coupon.deleteMany({ where: { code: CODE } });
  await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.user.deleteMany({ where: { id: { in: [userWithOrder, freshUser] } } });
  await prisma.$disconnect();
});

function evalFor(userId: string | null) {
  return evaluateCoupon({
    code: CODE,
    subtotalPaise: 100000,
    eligiblePaise: 100000,
    userId,
    guestEmail: userId ? null : 'guest@e2e.example',
  });
}

describe('first-order coupon', () => {
  it('applies for a signed-in customer with no previous orders', async () => {
    const res = await evalFor(freshUser);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.discountPaise).toBe(10000); // 10% of ₹1000
  });

  it('refuses a customer who already has a delivered order', async () => {
    const res = await evalFor(userWithOrder);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/first order/i);
  });

  it('refuses guests with a clear sign-in message', async () => {
    const res = await evalFor(null);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/signed in/i);
  });

  it('a cancelled order does not consume first-order eligibility', async () => {
    const cancelled = await prisma.order.create({
      data: {
        orderNumber: `RX-FC-${suffix.toUpperCase()}`,
        userId: freshUser,
        subtotal: '50.00',
        grandTotal: '50.00',
        shippingAddress: { city: 'Dibrugarh' },
        paymentMethod: 'COD',
        status: 'CANCELLED',
        paymentStatus: 'PENDING',
      },
    });
    try {
      const res = await evalFor(freshUser);
      expect(res.ok).toBe(true);
    } finally {
      await prisma.order.deleteMany({ where: { id: cancelled.id } });
    }
  });
});
