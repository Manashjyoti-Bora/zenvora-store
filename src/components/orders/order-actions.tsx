'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Field, Textarea, Select } from '@/components/ui/form';

const RETURN_REASONS = [
  'Product damaged on arrival',
  'Wrong item received',
  'Product different from description',
  'Size/fit issue',
  'Quality issue',
  'No longer needed',
];

/**
 * Customer order actions: cancel (with reason) and return request.
 * Eligibility is computed server-side and enforced again by the API.
 */
export function OrderActions({
  orderNumber,
  canCancel,
  cancelReasonHint,
  returnEligible,
  returnWindowDays,
  items,
}: {
  orderNumber: string;
  canCancel: boolean;
  cancelReasonHint?: string;
  returnEligible: boolean;
  returnWindowDays: number;
  items: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [returnReason, setReturnReason] = useState(RETURN_REASONS[0]);
  const [returnItem, setReturnItem] = useState<string>('');
  const [returnNote, setReturnNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!canCancel && !returnEligible) {
    return (
      <p className="text-center text-xs text-gray-400">
        {cancelReasonHint ??
          `Cancellation and returns are not available for this order right now. Returns are accepted within ${returnWindowDays} days of delivery.`}
      </p>
    );
  }

  async function submitCancel() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ refundInitiated?: boolean }>(
        '/api/orders/' + orderNumber + '/cancel',
        {
          body: { reason: cancelReason.trim() },
        }
      );
      toast(
        result.refundInitiated ? 'Order cancelled — refund initiated' : 'Order cancelled',
        'success'
      );
      setCancelOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not cancel the order.');
    } finally {
      setBusy(false);
    }
  }

  async function submitReturn() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/orders/' + orderNumber + '/return', {
        body: {
          orderItemId: returnItem || null,
          reason: returnReason,
          note: returnNote.trim() || null,
        },
      });
      toast('Return requested — our team will review it', 'success');
      setReturnOpen(false);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Could not submit the return request.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap justify-center gap-3">
      {canCancel && (
        <Button
          variant="outline"
          onClick={() => {
            setCancelOpen(true);
            setError(null);
          }}
        >
          Cancel order
        </Button>
      )}
      {returnEligible && (
        <Button
          variant="outline"
          onClick={() => {
            setReturnOpen(true);
            setError(null);
          }}
        >
          Request return / refund
        </Button>
      )}

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={`Cancel order ${orderNumber}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCancelOpen(false)} disabled={busy}>
              Keep order
            </Button>
            <Button
              variant="danger"
              onClick={submitCancel}
              loading={busy}
              disabled={cancelReason.trim().length < 3}
            >
              Confirm cancellation
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <p className="text-sm text-gray-600">
            If you already paid online, any refundable amount is returned to the original payment
            method (typically 5–7 business days after processing). This cannot be undone.
          </p>
          <Field
            label="Reason for cancellation"
            required
            hint="Helps us improve (min 3 characters)"
          >
            {(p) => (
              <Textarea
                {...p}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                maxLength={300}
                placeholder="e.g. Ordered by mistake"
              />
            )}
          </Field>
        </div>
      </Modal>

      <Modal
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        title="Request a return"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setReturnOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submitReturn} loading={busy}>
              Submit request
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <p className="text-sm text-gray-600">
            Returns are accepted within {returnWindowDays} days of delivery per our{' '}
            <a href="/policies/returns" className="link-primary">
              returns policy
            </a>
            . Our team reviews every request and responds by email.
          </p>
          {items.length > 1 && (
            <Field label="Which item?" hint="Leave as whole order to return everything">
              {(p) => (
                <Select {...p} value={returnItem} onChange={(e) => setReturnItem(e.target.value)}>
                  <option value="">Whole order</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Reason" required>
            {(p) => (
              <Select {...p} value={returnReason} onChange={(e) => setReturnReason(e.target.value)}>
                {RETURN_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Additional details"
            hint="Optional — condition of item, photos via email later, etc."
          >
            {(p) => (
              <Textarea
                {...p}
                value={returnNote}
                onChange={(e) => setReturnNote(e.target.value)}
                maxLength={1000}
              />
            )}
          </Field>
        </div>
      </Modal>
    </div>
  );
}
