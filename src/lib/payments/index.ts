import { isRazorpayConfigured, isTestPaymentsAllowed } from '../env';
import { logger } from '../logger';
import { RazorpayAdapter } from './razorpay';
import { TestPaymentAdapter } from './test-provider';
import type { PaymentProviderAdapter } from './types';

/**
 * Provider selection:
 *   1. Razorpay - whenever real credentials are configured (any environment).
 *   2. TEST provider - only when PAYMENTS_TEST_MODE=true and NOT production.
 *   3. null - checkout must then refuse payments with an honest, actionable
 *      error (never silently pretend).
 */
export function getPaymentProvider(): PaymentProviderAdapter | null {
  if (isRazorpayConfigured()) return new RazorpayAdapter();
  if (isTestPaymentsAllowed()) {
    return new TestPaymentAdapter();
  }
  logger.error(
    'No payment provider available: configure Razorpay keys or enable PAYMENTS_TEST_MODE (non-production only)'
  );
  return null;
}

export function describePaymentProvider(): {
  kind: 'RAZORPAY' | 'TEST' | 'NONE';
  label: string;
  isTest: boolean;
} {
  if (isRazorpayConfigured()) {
    return { kind: 'RAZORPAY', label: 'Razorpay', isTest: false };
  }
  if (isTestPaymentsAllowed()) {
    return { kind: 'TEST', label: 'TEST provider (development only)', isTest: true };
  }
  return { kind: 'NONE', label: 'Not configured', isTest: false };
}

export * from './types';
