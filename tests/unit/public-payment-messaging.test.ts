import { describe, expect, it } from 'vitest';

import {
  onlinePaymentOptionLabel,
  publicCheckoutInstruction,
  publicPaymentFaqAnswer,
  publicPaymentMethodLabel,
  publicPaymentSafetyFaq,
  publicPaymentTrustLabel,
  type PublicPaymentProvider,
  type PublicPaymentState,
} from '@/lib/payments/public-messaging';

const providers: PublicPaymentProvider[] = ['NONE', 'TEST', 'RAZORPAY'];

function messages(state: PublicPaymentState): string[] {
  const safety = publicPaymentSafetyFaq(state);
  return [
    publicPaymentMethodLabel(state),
    publicPaymentTrustLabel(state),
    publicCheckoutInstruction(state),
    publicPaymentFaqAnswer(state),
    safety.question,
    safety.answer,
    onlinePaymentOptionLabel(state.provider) ?? '',
  ];
}

describe('public payment messaging', () => {
  it.each(
    providers.flatMap((provider) => [true, false].map((codEnabled) => ({ provider, codEnabled })))
  )('never presents an unavailable or simulated provider as a live gateway: %o', (state) => {
    const text = messages(state).join('\n');
    if (state.provider !== 'RAZORPAY') {
      expect(text).not.toMatch(/via Razorpay|licensed payment gateway/i);
      expect(text).not.toMatch(/Pay online \(UPI|UPI \/ cards \/ netbanking/i);
    }
    if (state.provider === 'TEST') {
      expect(text).toMatch(/TEST/i);
      expect(text).toMatch(/no real money/i);
    }
  });

  it('NONE + COD advertises Cash on Delivery and no online payment option', () => {
    const state = { provider: 'NONE', codEnabled: true } as const;
    expect(publicPaymentMethodLabel(state)).toBe('Cash on Delivery');
    expect(publicPaymentTrustLabel(state)).toBe('Cash on Delivery');
    expect(publicCheckoutInstruction(state)).toContain(
      'Online payments are not currently available'
    );
    expect(publicPaymentFaqAnswer(state)).toContain('Online payments are not currently configured');
    expect(publicPaymentSafetyFaq(state).answer).toContain('not currently accepted');
    expect(onlinePaymentOptionLabel(state.provider)).toBeNull();
    expect(messages(state).join('\n')).not.toMatch(/Online payment \+|^Online payment$/);
  });

  it('NONE without COD fails closed in customer-facing instructions', () => {
    const state = { provider: 'NONE', codEnabled: false } as const;
    expect(publicPaymentMethodLabel(state)).toBe('Payment methods unavailable');
    expect(publicPaymentTrustLabel(state)).toBe('Online payments not configured');
    expect(publicCheckoutInstruction(state)).toContain('Checkout is unavailable');
    expect(publicPaymentFaqAnswer(state)).toContain('Cash on Delivery is unavailable');
    expect(publicPaymentSafetyFaq(state).answer).toContain('checkout cannot be completed');
    expect(onlinePaymentOptionLabel(state.provider)).toBeNull();
  });

  it('TEST always identifies the simulation and never promises a bank debit', () => {
    for (const codEnabled of [true, false]) {
      const state = { provider: 'TEST', codEnabled } as const;
      expect(publicPaymentMethodLabel(state)).toContain('TEST payment (no real money)');
      expect(publicPaymentTrustLabel(state)).toContain('TEST payments (no real money)');
      expect(publicCheckoutInstruction(state)).toContain('TEST payment simulator');
      expect(publicPaymentFaqAnswer(state)).toContain('development environment');
      expect(publicPaymentSafetyFaq(state).answer).toContain('never represent a real bank debit');
      expect(onlinePaymentOptionLabel(state.provider)).toBe(
        'TEST payment (simulation only — no real money)'
      );
      expect(publicPaymentMethodLabel(state).includes('Cash on Delivery')).toBe(codEnabled);
    }
  });

  it('RAZORPAY alone enables real online/UPI/card wording', () => {
    for (const codEnabled of [true, false]) {
      const state = { provider: 'RAZORPAY', codEnabled } as const;
      expect(publicPaymentMethodLabel(state)).toContain('Online payment');
      expect(publicPaymentTrustLabel(state)).toContain('Secure online payments via Razorpay');
      expect(publicCheckoutInstruction(state)).toContain('Pay online via Razorpay');
      expect(publicPaymentFaqAnswer(state)).toContain('UPI, cards and netbanking');
      expect(publicPaymentSafetyFaq(state).answer).toContain('server-side verification');
      expect(onlinePaymentOptionLabel(state.provider)).toBe(
        'Pay online (UPI / cards / netbanking)'
      );
      expect(publicPaymentMethodLabel(state).includes('Cash on Delivery')).toBe(codEnabled);
    }
  });
});
