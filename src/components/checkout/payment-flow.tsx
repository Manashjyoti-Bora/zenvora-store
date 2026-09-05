'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button, Spinner } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { formatINR } from '@/lib/money';

/* Razorpay Checkout.js is loaded on demand (only when a real gateway payment
 * starts). We declare only the shape we use. */
interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  handler: (resp: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  modal?: { ondismiss?: () => void };
}
interface RazorpayCtor {
  new (opts: RazorpayOptions): { open: () => void };
}
declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
  }
}

const RZP_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

function loadRazorpayScript(): Promise<RazorpayCtor> {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve(window.Razorpay);
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${RZP_SCRIPT}"]`);
    const script = existing ?? document.createElement('script');
    if (!existing) {
      script.src = RZP_SCRIPT;
      script.async = true;
      document.body.appendChild(script);
    }
    script.onload = () =>
      window.Razorpay
        ? resolve(window.Razorpay)
        : reject(new Error('Razorpay failed to initialise'));
    script.onerror = () =>
      reject(
        new Error('Could not load the secure payment window. Check your connection and try again.')
      );
  });
}

type Phase =
  'idle' | 'starting' | 'gateway-open' | 'verifying' | 'test-panel' | 'failed' | 'pending';

interface CreateResponse {
  mode: 'razorpay-checkout-js' | 'test-simulator' | 'unconfigured';
  provider: string;
  providerOrderId: string;
  amountPaise: number;
  currency: string;
  orderNumber: string;
  keyId: string | null;
  storeName: string;
  prefill: { name: string; email: string; contact: string };
}

export function PaymentFlow({
  orderNumber,
  amountPaise,
  guestEmail,
  initialFailure,
}: {
  orderNumber: string;
  amountPaise: number;
  guestEmail?: string;
  initialFailure?: string | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(initialFailure ?? null);
  const [testOutcomeBusy, setTestOutcomeBusy] = useState<'success' | 'failure' | null>(null);

  async function start() {
    setPhase('starting');
    setError(null);
    try {
      const data = await apiFetch<CreateResponse>('/api/payments/create', {
        body: { orderNumber, email: guestEmail },
      });

      if (data.mode === 'test-simulator') {
        setPhase('test-panel');
        return;
      }

      if (data.mode !== 'razorpay-checkout-js' || !data.keyId) {
        setError(
          'Online payments are not configured on this store yet. Please choose Cash on Delivery at checkout, or contact support.'
        );
        setPhase('failed');
        return;
      }

      const Razorpay = await loadRazorpayScript();
      setPhase('gateway-open');
      const rzp = new Razorpay({
        key: data.keyId,
        amount: data.amountPaise,
        currency: data.currency,
        name: data.storeName,
        description: `Order ${data.orderNumber}`,
        order_id: data.providerOrderId,
        prefill: {
          name: data.prefill.name || undefined,
          email: data.prefill.email || undefined,
          contact: data.prefill.contact || undefined,
        },
        notes: { order_number: data.orderNumber },
        theme: { color: '#20573c' },
        handler: async (resp) => {
          setPhase('verifying');
          try {
            // Server re-verifies with the gateway + HMAC signature before
            // anything is confirmed - this call only reports the result.
            const result = await apiFetch<{ status: string; redirect: string; reason?: string }>(
              '/api/payments/verify',
              {
                body: {
                  orderNumber,
                  providerOrderId: resp.razorpay_order_id,
                  providerPaymentId: resp.razorpay_payment_id,
                  signature: resp.razorpay_signature,
                  email: guestEmail,
                },
              }
            );
            if (result.status === 'FAILED') {
              setPhase('failed');
              setError(result.reason ?? 'Payment failed.');
              return;
            }
            if (result.status === 'PENDING') {
              setPhase('pending');
              return;
            }
            router.push(result.redirect);
          } catch (err) {
            setPhase('failed');
            setError(
              err instanceof ApiClientError
                ? err.message
                : 'We could not verify the payment result. Do not pay again - contact support with your order number.'
            );
          }
        },
        modal: {
          ondismiss: () => {
            setPhase('failed');
            setError(
              'Payment window was closed before completing. Your order is saved - you can retry.'
            );
          },
        },
      });
      rzp.open();
    } catch (err) {
      setPhase('failed');
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Could not start the payment. Please check your connection and try again.'
      );
    }
  }

  async function simulateTest(outcome: 'success' | 'failure') {
    setTestOutcomeBusy(outcome);
    try {
      const result = await apiFetch<{ redirect: string }>('/api/payments/test/simulate', {
        body: { orderNumber, outcome, email: guestEmail },
      });
      toast(
        outcome === 'success' ? 'TEST payment marked successful' : 'TEST payment marked failed',
        outcome === 'success' ? 'success' : 'error'
      );
      if (outcome === 'success') {
        router.push(result.redirect);
      } else {
        setPhase('failed');
        setError('Simulated failure (TEST mode). You can retry - no real money is involved.');
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Test simulator unavailable.');
    } finally {
      setTestOutcomeBusy(null);
    }
  }

  return (
    <div className="card space-y-4 p-5 sm:p-6">
      {phase === 'idle' && (
        <>
          {error && <Alert tone="warning">{error}</Alert>}
          <p className="text-sm text-gray-600">
            You will be taken to a secure payment window to pay{' '}
            <strong className="tabular-nums">{formatINR(amountPaise)}</strong> for order{' '}
            <strong>{orderNumber}</strong>. We never see or store your card or UPI credentials.
          </p>
          <Button size="lg" className="w-full" onClick={start}>
            Pay {formatINR(amountPaise)} securely
          </Button>
        </>
      )}

      {(phase === 'starting' || phase === 'verifying') && (
        <div className="flex flex-col items-center gap-3 py-6" role="status" aria-live="polite">
          <Spinner className="h-7 w-7 text-brand-600" />
          <p className="text-sm text-gray-600">
            {phase === 'starting'
              ? 'Opening secure payment window…'
              : 'Verifying your payment with the gateway…'}
          </p>
          <p className="text-xs text-gray-400">Please do not close or refresh this page.</p>
        </div>
      )}

      {phase === 'gateway-open' && (
        <div className="py-4 text-center text-sm text-gray-500" role="status">
          Payment window open. If it did not appear,{' '}
          <button type="button" onClick={start} className="link-primary">
            open it again
          </button>
          .
        </div>
      )}

      {phase === 'test-panel' && (
        <div className="space-y-4">
          <Alert tone="warning" title="TEST payment mode">
            This store has no live payment gateway credentials yet. The TEST provider runs the exact
            same order pipeline but <strong>no real money moves</strong>. This panel never appears
            in production.
          </Alert>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Button
              variant="success"
              size="lg"
              onClick={() => simulateTest('success')}
              loading={testOutcomeBusy === 'success'}
              disabled={testOutcomeBusy !== null}
            >
              Simulate successful payment
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => simulateTest('failure')}
              loading={testOutcomeBusy === 'failure'}
              disabled={testOutcomeBusy !== null}
            >
              Simulate failed payment
            </Button>
          </div>
        </div>
      )}

      {phase === 'failed' && (
        <div className="space-y-4">
          <Alert tone="error" title="Payment not completed">
            {error ?? 'The payment could not be completed.'}
          </Alert>
          <p className="text-sm text-gray-600">
            Your order <strong>{orderNumber}</strong> is saved and its items are reserved. Nothing
            has been charged unless your bank shows a debit — in that case do not retry and contact
            support immediately.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button size="lg" onClick={start} className="flex-1">
              Retry payment
            </Button>
            <Link
              href="/contact"
              className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-center text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Contact support
            </Link>
          </div>
        </div>
      )}

      {phase === 'pending' && (
        <div className="space-y-4">
          <Alert tone="info" title="Payment is being confirmed">
            Your bank has accepted the payment but final confirmation is still in progress. This
            usually resolves within a few minutes. We will email you as soon as it is confirmed —
            please do not pay again.
          </Alert>
          <Button
            variant="outline"
            className="w-full"
            onClick={() =>
              router.push(
                `/order/${orderNumber}/confirmation${guestEmail ? `?email=${encodeURIComponent(guestEmail)}` : ''}`
              )
            }
          >
            View order status
          </Button>
        </div>
      )}
    </div>
  );
}
