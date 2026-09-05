'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { Alert } from '@/components/ui/feedback';

/**
 * Manual settlement for refunds the gateway could not process automatically
 * (e.g. TEST-provider refunds, or gateway refunds completed out-of-band).
 */
export function RefundSettleButton({ refundId }: { refundId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'COMPLETED' | 'FAILED' | null>(null);

  async function settle(status: 'COMPLETED' | 'FAILED') {
    setBusy(status);
    try {
      await apiFetch(`/api/admin/refunds/${refundId}/settle`, {
        body: { status, note: note.trim() || null },
      });
      toast(
        status === 'COMPLETED'
          ? 'Refund marked completed — profit recalculated'
          : 'Refund marked failed',
        'success'
      );
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Could not update refund', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Settle manually
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Settle refund manually"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy !== null}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => settle('FAILED')}
              loading={busy === 'FAILED'}
              disabled={busy !== null}
            >
              Mark failed
            </Button>
            <Button
              variant="success"
              onClick={() => settle('COMPLETED')}
              loading={busy === 'COMPLETED'}
              disabled={busy !== null}
            >
              Mark completed
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Alert tone="warning">
            Only use this when the money movement happened (or definitively failed) outside the
            automatic gateway flow — e.g. TEST-mode refunds or a bank transfer you made manually.
            Marking COMPLETED finalises the order&apos;s actual profit.
          </Alert>
          <Field label="Note (audit log)" hint="e.g. 'NEFT done, UTR 12345'">
            {(p) => (
              <Textarea
                {...p}
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
              />
            )}
          </Field>
        </div>
      </Modal>
    </>
  );
}
