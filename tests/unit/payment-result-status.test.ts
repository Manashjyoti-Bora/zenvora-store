import { describe, expect, it } from 'vitest';
import {
  canApplyPaymentResultToStatus,
  isCapturedPaymentStatus,
  type PaymentRecordStatus,
  type PaymentResultOutcome,
} from '@/lib/payments/types';

describe('payment result terminal-state protection', () => {
  const cases: Array<[PaymentRecordStatus, PaymentResultOutcome, boolean]> = [
    ['CREATED', 'PAID', true],
    ['FAILED', 'PAID', true],
    ['PAID', 'PAID', true],
    ['PARTIALLY_REFUNDED', 'PAID', false],
    ['REFUNDED', 'PAID', false],
    ['CREATED', 'FAILED', true],
    ['FAILED', 'FAILED', true],
    ['PAID', 'FAILED', false],
    ['PARTIALLY_REFUNDED', 'FAILED', false],
    ['REFUNDED', 'FAILED', false],
  ];

  it.each(cases)('%s + %s => %s', (status, outcome, expected) => {
    expect(canApplyPaymentResultToStatus(status, outcome)).toBe(expected);
  });

  it('recognizes every captured/refunded state, including partial refunds', () => {
    expect(isCapturedPaymentStatus('PAID')).toBe(true);
    expect(isCapturedPaymentStatus('PARTIALLY_REFUNDED')).toBe(true);
    expect(isCapturedPaymentStatus('REFUNDED')).toBe(true);
    expect(isCapturedPaymentStatus('CREATED')).toBe(false);
    expect(isCapturedPaymentStatus('FAILED')).toBe(false);
  });
});
