'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { formatINR } from '@/lib/money';
import { toast } from '@/components/ui/toaster';

interface ManualUpiPaymentProps {
  orderNumber: string;
  amountPaise: number;
  guestEmail?: string;
  upiConfig: {
    upiVpa: string;
    payeeName: string;
    qrImageUrl: string;
    instructions: string;
  };
  currentUtr?: string | null;
  paymentStatus: string;
  rejectionReason?: string | null;
}

export function ManualUpiPayment({
  orderNumber,
  amountPaise,
  guestEmail,
  upiConfig,
  currentUtr,
  paymentStatus,
  rejectionReason,
}: ManualUpiPaymentProps) {
  const router = useRouter();
  const [utr, setUtr] = useState(currentUtr ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedUtr, setSubmittedUtr] = useState<string | null>(currentUtr ?? null);

  const isPendingVerification = paymentStatus === 'PENDING_VERIFICATION' || Boolean(submittedUtr);

  // Generate UPI URI if VPA exists
  const amountRupees = (amountPaise / 100).toFixed(2);
  const upiUri = upiConfig.upiVpa
    ? `upi://pay?pa=${encodeURIComponent(upiConfig.upiVpa)}&pn=${encodeURIComponent(
        upiConfig.payeeName || 'Zenvora'
      )}&am=${amountRupees}&cu=INR&tn=Order%20${orderNumber}`
    : null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const cleanUtr = utr.trim();
    if (!cleanUtr) {
      setError('Please enter the 12-digit transaction reference (UTR).');
      return;
    }
    if (cleanUtr.length < 8 || cleanUtr.length > 30) {
      setError('Transaction reference / UTR should be between 8 and 30 characters.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch<{ ok: boolean; message: string }>('/api/payments/manual-upi/submit', {
        body: {
          orderNumber,
          utr: cleanUtr,
          email: guestEmail,
        },
      });
      setSubmittedUtr(cleanUtr);
      toast(res.message || 'Payment reference submitted successfully for verification', 'success');
      router.refresh();
    } catch (err_) {
      if (err_ instanceof ApiClientError) {
        setError(err_.message);
      } else {
        setError('Could not submit payment reference. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card space-y-5 p-5 sm:p-6">
      <div className="border-b border-ink-900/10 pb-4">
        <h2 className="text-lg font-semibold text-ink-900">Scan & Pay via UPI QR</h2>
        <p className="mt-1 text-xs text-ink-500">
          Pay exact amount <strong className="tabular-nums text-ink-900">{formatINR(amountPaise)}</strong> to our official store UPI ID.
        </p>
      </div>

      {rejectionReason && (
        <Alert tone="error" title="Previous verification rejected">
          Reason: {rejectionReason}. Please double check your payment details or provide the correct UTR reference.
        </Alert>
      )}

      {error && <Alert tone="warning">{error}</Alert>}

      {/* QR Code and Payment details */}
      <div className="flex flex-col items-center justify-center rounded-xl bg-cream-50 p-6 text-center">
        {upiConfig.qrImageUrl ? (
          <div className="relative mb-4 h-48 w-48 overflow-hidden rounded-lg border border-ink-900/10 bg-white p-2 shadow-sm">
            <Image
              src={upiConfig.qrImageUrl}
              alt="UPI Payment QR Code"
              fill
              className="object-contain"
              unoptimized
            />
          </div>
        ) : (
          <div className="mb-4 flex h-48 w-48 flex-col items-center justify-center rounded-lg border-2 border-dashed border-ink-900/20 bg-white p-4 text-center">
            <span className="text-xs font-semibold text-ink-600">Scan via any UPI App</span>
            <span className="mt-1 text-[11px] text-ink-400">GPay, PhonePe, Paytm, BHIM</span>
            {upiConfig.upiVpa ? (
              <span className="mt-3 block font-mono text-xs font-bold text-brand-700">
                {upiConfig.upiVpa}
              </span>
            ) : (
              <span className="mt-3 block text-[11px] text-amber-700">
                Store UPI ID active
              </span>
            )}
          </div>
        )}

        <div className="space-y-1 text-sm">
          {upiConfig.payeeName && (
            <p className="text-xs text-ink-500">
              Payee: <strong className="text-ink-900">{upiConfig.payeeName}</strong>
            </p>
          )}
          {upiConfig.upiVpa && (
            <p className="text-xs text-ink-500">
              UPI ID:{' '}
              <span className="font-mono font-semibold text-ink-900 selection:bg-brand-100">
                {upiConfig.upiVpa}
              </span>
            </p>
          )}
          <p className="text-xs font-semibold text-brand-800">
            Amount: <span className="tabular-nums">{formatINR(amountPaise)}</span>
          </p>
        </div>

        {upiUri && (
          <a
            href={upiUri}
            className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-xs font-medium text-white shadow-soft transition-colors hover:bg-brand-700 sm:hidden"
          >
            Pay directly in UPI App
          </a>
        )}
      </div>

      <div className="rounded-lg border border-ink-900/10 bg-white p-4 text-xs text-ink-600">
        <p className="font-semibold text-ink-900">Payment Instructions:</p>
        <p className="mt-1 leading-relaxed text-ink-500">{upiConfig.instructions}</p>
      </div>

      {isPendingVerification ? (
        <div className="space-y-4">
          <Alert tone="info" title="Payment reference under review">
            Submitted UTR: <strong className="font-mono">{submittedUtr}</strong>
            <p className="mt-1 text-xs">
              Our operations team is manually verifying this transaction against our bank statement.
              Your order will be confirmed as soon as payment verification completes.
            </p>
          </Alert>

          <form onSubmit={handleSubmit} className="space-y-3 pt-2">
            <label className="block text-xs font-medium text-ink-700">
              Need to update or re-enter your UTR?
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={utr}
                onChange={(e) => setUtr(e.target.value)}
                placeholder="Enter 12-digit UPI UTR"
                className="input-base text-sm font-mono flex-1"
                disabled={submitting}
              />
              <Button type="submit" loading={submitting} size="sm">
                Update UTR
              </Button>
            </div>
          </form>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink-700">
              Transaction ID / UTR / Reference Number <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={utr}
              onChange={(e) => setUtr(e.target.value)}
              placeholder="e.g. 431289102938"
              className="input-base mt-1.5 text-sm font-mono w-full"
              disabled={submitting}
              required
            />
            <p className="mt-1 text-[11px] text-ink-400">
              Find this 12-digit number in your UPI app (Google Pay, PhonePe, Paytm) payment receipt.
            </p>
          </div>

          <Button type="submit" size="lg" className="w-full" loading={submitting}>
            Submit transaction reference
          </Button>
        </form>
      )}
    </div>
  );
}
