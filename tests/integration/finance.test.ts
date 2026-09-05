import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { toPaise } from '@/lib/money';
import { registerUser } from '@/lib/auth/service';
import { addToCart } from '@/lib/cart/service';
import { createOrderFromCart } from '@/lib/orders/create';
import { recalcOrderFinancials, adjustOrderCosts } from '@/lib/orders/finance';
import { transitionOrder } from '@/lib/orders/state';
import { updateSettings } from '@/lib/settings';
import { cleanupTestData, createTestProduct, testEmail, TEST_ADDRESS } from './fixtures';

/**
 * The finance engine: actual profit must reflect supplier cost, shipping paid,
 * gateway fees, other costs and refunds — never just gross margin.
 */
describe('order finance engine (actual profit)', () => {
  let orderId: string;
  let userId: string;

  beforeAll(async () => {
    await cleanupTestData();
    await updateSettings({
      payments: { feePercent: 2, feeFixedPaise: 0 },
      shipping: { flatRatePaise: 4900, freeAbovePaise: 99900, codEnabled: false, codFeePaise: 0 },
    });
    const product = await createTestProduct({
      name: 'Itest Finance Product',
      stock: 10,
      sellingPrice: '250.00',
      supplierCost: '100.00',
      supplierShippingCost: '0.00',
    });
    const user = await registerUser({
      email: testEmail('finance'),
      password: 'Str0ng!Passphrase',
      name: 'Finance Tester',
    });
    userId = user.user.id;
    const view = await addToCart({ userId, productId: product.id, quantity: 2 });
    const result = await createOrderFromCart({
      cartId: view.cartId,
      user: {
        id: userId,
        email: user.user.email,
        name: 'Finance Tester',
        role: 'CUSTOMER',
        status: 'ACTIVE',
      },
      address: TEST_ADDRESS,
      paymentMethod: 'PREPAID_GATEWAY',
    });
    orderId = result.orderId;
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it('baseline: profit = revenue − supplier cost (nothing else recorded yet)', async () => {
    const o = await recalcOrderFinancials(orderId);
    // revenue = 500 (subtotal) + 49 (shipping charged) = 549; supplier cost = 2 × 100 = 200
    expect(toPaise(o.supplierCostTotal)).toBe(20_000);
    expect(toPaise(o.paymentFeeTotal)).toBe(0);
    expect(toPaise(o.actualProfit)).toBe(54_900 - 20_000);
    expect(o.profitFinalizedAt).toBeNull(); // not delivered yet → estimate
  }, 20_000);

  it('real gateway fees (from the payment record) replace estimates', async () => {
    await prisma.payment.create({
      data: {
        orderId,
        provider: 'TEST',
        providerOrderId: `itest-pay-${Date.now()}`,
        providerPaymentId: `itest-payid-${Date.now()}`,
        amount: '549.00',
        status: 'PAID',
        feeAmount: '12.00', // what the gateway actually charged
        feeIsEstimate: false,
        paidAt: new Date(),
      },
    });
    const o = await recalcOrderFinancials(orderId);
    expect(toPaise(o.paymentFeeTotal)).toBe(1_200);
    expect(toPaise(o.actualProfit)).toBe(54_900 - 20_000 - 1_200);
  }, 20_000);

  it('manual cost adjustments (shipping paid, other costs) reduce actual profit', async () => {
    const o = await adjustOrderCosts(orderId, { shippingCostPaise: 6_000, otherCostPaise: 500 });
    expect(toPaise(o.shippingCostTotal)).toBe(6_000);
    expect(toPaise(o.otherCostTotal)).toBe(500);
    // 54900 − 20000 supplier − 1200 fees − 6000 shipping − 500 other
    expect(toPaise(o.actualProfit)).toBe(54_900 - 20_000 - 1_200 - 6_000 - 500);
  }, 20_000);

  it('profit is NOT gross margin: margin would claim ₹300, actual is far less', async () => {
    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const grossMargin = toPaise(o.subtotal) - toPaise(o.supplierCostTotal); // 500 − 200 = 300
    expect(grossMargin).toBe(30_000);
    expect(toPaise(o.actualProfit)).toBeLessThan(grossMargin);
  });

  it('estimated fees keep profit un-finalised (honesty about unknowns)', async () => {
    await prisma.payment.updateMany({ where: { orderId }, data: { feeIsEstimate: true } });
    const o = await recalcOrderFinancials(orderId);
    // fee now estimated from settings: 2% of 549 = 1098 paise
    expect(toPaise(o.paymentFeeTotal)).toBe(1_098);
    expect(o.profitFinalizedAt).toBeNull(); // estimate present → not final
  }, 20_000);

  it('delivery with real fees finalises profit', async () => {
    // gateway reports the actual charge → estimates replaced
    await prisma.payment.updateMany({
      where: { orderId },
      data: { feeIsEstimate: false, feeAmount: '12.00' },
    });
    // walk the state machine like the fulfilment pipeline does
    for (const to of [
      'PAYMENT_VERIFIED',
      'ORDER_CONFIRMED',
      'SENT_TO_SUPPLIER',
      'PROCESSING',
      'SHIPPED',
      'DELIVERED',
    ] as const) {
      await transitionOrder({ orderId, to, actorType: 'SYSTEM', message: `test → ${to}` });
    }
    const o = await recalcOrderFinancials(orderId);
    expect(o.status).toBe('DELIVERED');
    expect(o.profitFinalizedAt).not.toBeNull();
    expect(toPaise(o.actualProfit)).toBe(54_900 - 20_000 - 1_200 - 6_000 - 500);
  }, 20_000);

  it('refunds subtract from actual profit and accumulate in refundedTotal', async () => {
    await prisma.refund.create({
      data: {
        orderId,
        amount: '50.00',
        status: 'COMPLETED',
        reason: 'Partial refund — item damaged (test)',
        initiatedBy: 'ADMIN',
        processedAt: new Date(),
      },
    });
    const o = await recalcOrderFinancials(orderId);
    expect(toPaise(o.refundedTotal)).toBe(5_000);
    expect(toPaise(o.actualProfit)).toBe(54_900 - 20_000 - 1_200 - 6_000 - 500 - 5_000);
  }, 20_000);

  it('finalisation is monotonic: once final, a later recalc keeps it final', async () => {
    const o = await recalcOrderFinancials(orderId);
    expect(o.profitFinalizedAt).not.toBeNull();
  }, 20_000);
});
