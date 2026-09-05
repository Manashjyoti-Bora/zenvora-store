'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { Alert } from '@/components/ui/feedback';

type Decision = 'APPROVE' | 'REJECT' | 'MARK_RECEIVED' | 'CLOSE';

const DECISION_INFO: Record<Decision, { label: string; hint: string }> = {
  APPROVE: {
    label: 'Approve (issue refund)',
    hint: 'Approves the return and issues the refund amount below to the original payment method. Use after the item is received & checked, or immediately for damaged/lost cases.',
  },
  REJECT: {
    label: 'Reject',
    hint: 'Rejects the request with a note. The customer is emailed the decision.',
  },
  MARK_RECEIVED: {
    label: 'Mark item received',
    hint: 'Records that the returned item arrived (inspection pending). No refund yet.',
  },
  CLOSE: {
    label: 'Close request',
    hint: 'Closes the request without refund (e.g. resolved by replacement or customer withdrew).',
  },
};

export function ReturnDecisionButton({
  returnId,
  status,
  maxRefundRupees,
}: {
  returnId: string;
  status: string;
  maxRefundRupees: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allowed: Decision[] =
    status === 'REQUESTED' || status === 'RECEIVED'
      ? ['APPROVE', 'REJECT', 'MARK_RECEIVED', 'CLOSE']
      : status === 'APPROVED'
        ? ['MARK_RECEIVED', 'CLOSE']
        : [];
  const [decision, setDecision] = useState<Decision>(allowed[0] ?? 'APPROVE');
  const [refundAmount, setRefundAmount] = useState(maxRefundRupees.toFixed(2));
  const [note, setNote] = useState('');

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/returns/${returnId}/decide`, {
        body: {
          decision,
          adminNote: note.trim() || null,
          refundAmount: decision === 'APPROVE' ? Number(refundAmount) : null,
        },
      });
      toast(`Return ${decision.toLowerCase().replace('_', ' ')}d — customer notified`, 'success');
      setOpen(false);
      router.refresh();
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : 'Decision failed';
      setError(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (allowed.length === 0) return null;

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          setOpen(true);
          setDecision(allowed[0]);
          setError(null);
        }}
      >
        Decide
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Return request decision"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={decision === 'REJECT' ? 'danger' : 'primary'}
              onClick={submit}
              loading={busy}
            >
              Confirm decision
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Decision" required>
            {(p) => (
              <Select
                {...p}
                value={decision}
                onChange={(e) => setDecision(e.target.value as Decision)}
              >
                {allowed.map((d) => (
                  <option key={d} value={d}>
                    {DECISION_INFO[d].label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <p className="text-xs text-gray-500">{DECISION_INFO[decision].hint}</p>
          {decision === 'APPROVE' && (
            <Field
              label="Refund amount (₹)"
              required
              hint={`Max refundable for this request: ₹${maxRefundRupees.toFixed(2)}. Partial refunds are allowed (e.g. used/damaged deductions).`}
            >
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                />
              )}
            </Field>
          )}
          <Field label="Note to customer" hint="Included in the decision email">
            {(p) => (
              <Textarea
                {...p}
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
                placeholder={decision === 'REJECT' ? 'Reason for rejection…' : 'Optional context…'}
              />
            )}
          </Field>
        </div>
      </Modal>
    </>
  );
}
