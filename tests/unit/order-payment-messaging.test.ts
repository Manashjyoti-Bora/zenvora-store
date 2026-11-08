import { describe, expect, it } from 'vitest';
import { describeOrderPayment, recordedPaymentProvider } from '@/lib/payments/order-messaging';
import { renderTemplate, type TemplateVars } from '@/lib/notifications/templates';

const testAttempt = { provider: 'TEST', status: 'PAID', paidAt: new Date('2026-01-02') };
const razorAttempt = { provider: 'RAZORPAY', status: 'PAID', paidAt: new Date('2026-01-03') };

describe('historical order payment wording', () => {
  it('keeps COD pending and collected states distinct from online payments', () => {
    const pending = describeOrderPayment({ paymentMethod: 'COD', paymentStatus: 'COD_PENDING' });
    expect(pending.methodLabel).toBe('Cash on Delivery');
    expect(pending.confirmationDetail).toMatch(/pay.*cash.*delivered/i);
    expect(pending.refundPendingDetail).toMatch(/manual Cash on Delivery refund/i);
    expect(pending.refundPendingDetail).toMatch(/No payment gateway/i);
    expect(pending.refundCompletedDetail).toMatch(/internal settlement record/i);
    expect(pending.refundCompletedDetail).toMatch(/not independent proof of a bank deposit/i);

    const collected = describeOrderPayment({ paymentMethod: 'COD', paymentStatus: 'PAID' });
    expect(collected.confirmationTitle).toBe('Cash collection recorded');
    expect(collected.methodLabel).not.toMatch(/online|prepaid/i);

    const partiallyRefunded = describeOrderPayment({
      paymentMethod: 'COD',
      paymentStatus: 'PARTIALLY_REFUNDED',
    });
    expect(partiallyRefunded.confirmationTitle).toBe('Cash collection recorded');
    expect(partiallyRefunded.confirmationDetail).toContain('recorded cash collection');
    expect(partiallyRefunded.confirmationDetail).not.toContain('Pay the order total');
  });

  it.each(['PENDING', 'FAILED', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'])(
    'always identifies TEST state %s as a simulation with no real money',
    (paymentStatus) => {
      const copy = describeOrderPayment({
        paymentMethod: 'PREPAID_GATEWAY',
        paymentStatus,
        payments: [{ ...testAttempt, status: paymentStatus === 'FAILED' ? 'FAILED' : 'PAID' }],
      });
      expect(copy.isTest).toBe(true);
      expect(copy.methodLabel).toMatch(/TEST.*simulation/i);
      expect(copy.confirmationDetail).toMatch(/no real money moved/i);
      expect(copy.paymentFailureDetail).toMatch(/no real money moved/i);
      expect(copy.refundPendingDetail).toMatch(/TEST refund simulation/i);
      expect(copy.refundPendingDetail).toMatch(/no real money moves/i);
      expect(copy.refundCompletedDetail).toMatch(/no real money moved/i);
      expect(copy.methodLabel).not.toMatch(/Razorpay|UPI|card/i);
    }
  );

  it('uses Razorpay wording only when that provider is recorded on the order', () => {
    const copy = describeOrderPayment({
      paymentMethod: 'PREPAID_GATEWAY',
      paymentStatus: 'PAID',
      payments: [razorAttempt],
    });
    expect(copy.methodLabel).toBe('Online payment (Razorpay)');
    expect(copy.confirmationTitle).toBe('Razorpay payment confirmed');
    expect(copy.refundPendingDetail).toMatch(/initiated with Razorpay/i);
    expect(copy.refundCompletedDetail).toMatch(/Razorpay has marked/i);
    expect(copy.isTest).toBe(false);
  });

  it('does not invent a provider for legacy attempts with no provider record', () => {
    const copy = describeOrderPayment({
      paymentMethod: 'PREPAID_GATEWAY',
      paymentStatus: 'PAID',
      payments: [],
    });
    expect(copy.provider).toBeNull();
    expect(copy.methodLabel).toBe('Online payment');
    expect(copy.confirmationDetail).toMatch(/No provider detail was stored/i);
    expect(copy.refundPendingDetail).not.toMatch(/Razorpay|TEST/);
  });

  it('prefers the captured provider over a newer failed retry', () => {
    const payments = [
      { provider: 'RAZORPAY', status: 'FAILED', createdAt: new Date('2026-01-04') },
      testAttempt,
    ];
    expect(recordedPaymentProvider(payments)).toBe('TEST');
    expect(recordedPaymentProvider([testAttempt, razorAttempt])).toBe('RAZORPAY');
  });
});

const ctx = { storeName: 'Isolated Test Store', supportEmail: '', appUrl: 'https://test.invalid' };
const vars: TemplateVars = {
  customerName: 'Test Customer',
  orderNumber: 'RX-TEST-1',
  paymentMethod: 'TEST payment (simulation only)',
  paymentIsTest: 'true',
  paymentSubjectPrefix: '[TEST SIMULATION — NO REAL MONEY] ',
  orderConfirmationHeading: 'TEST payment simulated successfully',
  totalLabel: 'TEST order total (no real charge)',
  paymentFailureDetail: 'TEST simulation failed. No real money moved.',
  refundPendingDetail: 'TEST refund simulation pending. No real money moves.',
  refundCompletedDetail: 'TEST refund simulation completed. No real money moved.',
  linesHtml: '<div>Isolated item</div>',
  itemsSummary: 'Isolated item x 1',
  total: '₹1.00',
  refundAmount: '₹1.00',
  addressHtml: 'Test address',
  estimatedDelivery: '3-7 days',
  trackUrl: 'https://test.invalid/track',
  orderUrl: 'https://test.invalid/order',
  retryUrl: 'https://test.invalid/retry',
  returnWindowDays: '7',
  returnStatus: 'REQUESTED',
  reason: 'Isolated test',
};

describe('provider-aware notification templates', () => {
  it.each([
    'ORDER_CONFIRMATION',
    'PAYMENT_FAILED',
    'ORDER_PROCESSING',
    'ORDER_SHIPPED',
    'ORDER_DELIVERED',
    'ORDER_CANCELLED',
    'REFUND_INITIATED',
    'REFUND_COMPLETED',
    'RETURN_UPDATE',
  ] as const)('%s labels TEST in the subject and never implies a live charge', (template) => {
    const rendered = renderTemplate(template, vars, ctx);
    expect(rendered.subject).toContain('[TEST SIMULATION — NO REAL MONEY]');
    expect(`${rendered.subject}\n${rendered.html}\n${rendered.text}`).not.toMatch(
      /processed by the payment gateway|real bank debit/i
    );
  });

  it('describes a completed manual COD refund without gateway or bank-deposit claims', () => {
    const copy = describeOrderPayment({ paymentMethod: 'COD', paymentStatus: 'PAID' });
    const rendered = renderTemplate(
      'REFUND_COMPLETED',
      {
        ...vars,
        paymentMethod: copy.methodLabel,
        paymentIsTest: 'false',
        paymentSubjectPrefix: '',
        refundCompletedDetail: copy.refundCompletedDetail,
      },
      ctx
    );
    expect(rendered.subject).not.toContain('TEST SIMULATION');
    expect(rendered.html).toContain('Manual refund settlement recorded');
    expect(rendered.html).toContain('No payment gateway was used');
    expect(rendered.html).toContain('not independent proof of a bank deposit');
    expect(rendered.html).not.toContain('processed by the payment gateway');
  });

  it('retains provider and bank timing for a real Razorpay refund', () => {
    const copy = describeOrderPayment({
      paymentMethod: 'PREPAID_GATEWAY',
      paymentStatus: 'PAID',
      payments: [razorAttempt],
    });
    const rendered = renderTemplate(
      'REFUND_COMPLETED',
      {
        ...vars,
        paymentMethod: copy.methodLabel,
        paymentIsTest: 'false',
        paymentSubjectPrefix: '',
        refundCompletedDetail: copy.refundCompletedDetail,
      },
      ctx
    );
    expect(rendered.html).toContain('Razorpay has marked this refund as processed');
    expect(rendered.html).toContain('5–7 business days');
    expect(rendered.html).not.toContain('TEST SIMULATION');
  });
});
