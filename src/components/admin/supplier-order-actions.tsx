'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { Alert } from '@/components/ui/feedback';

export function SupplierOrderActions({
  supplierOrderId,
  status,
  manualCancellationRequired = false,
  manualCancellationAvailable = false,
}: {
  supplierOrderId: string;
  status: string;
  manualCancellationRequired?: boolean;
  manualCancellationAvailable?: boolean;
}) {
  const router = useRouter();
  const [shipOpen, setShipOpen] = useState(false);
  const [manualCancelOpen, setManualCancelOpen] = useState(false);
  const [manualCancelNote, setManualCancelNote] = useState('');
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canShip =
    !manualCancellationRequired && !['SHIPPED', 'DELIVERED', 'CANCELLED'].includes(status);
  const canRetry = !manualCancellationRequired && ['FAILED', 'REJECTED', 'QUEUED'].includes(status);

  async function retry() {
    setBusy(true);
    try {
      await apiFetch(`/api/admin/supplier-orders/${supplierOrderId}/retry`);
      toast('Fulfilment retry queued', 'success');
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Retry failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function recordManualCancellation() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/supplier-orders/${supplierOrderId}/manual-cancel`, {
        body: { note: manualCancelNote.trim() },
      });
      toast('Manual confirmation recorded; no supplier API call was made.', 'success');
      setManualCancelOpen(false);
      setManualCancelNote('');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not record confirmation');
    } finally {
      setBusy(false);
    }
  }

  async function ship() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/supplier-orders/${supplierOrderId}/ship`, {
        body: {
          carrier: carrier.trim() || null,
          trackingNumber: trackingNumber.trim() || null,
          trackingUrl: trackingUrl.trim() || null,
        },
      });
      toast('Marked as shipped — customer notified', 'success');
      setShipOpen(false);
      router.refresh();
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : 'Could not record shipment';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex justify-end gap-2">
      {manualCancellationAvailable && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setManualCancelOpen(true);
            setError(null);
          }}
        >
          {status === 'CANCELLED' ? 'Verify supplier cancellation' : 'Record manual cancellation'}
        </Button>
      )}
      {canRetry && (
        <Button variant="outline" size="sm" onClick={retry} loading={busy}>
          Retry
        </Button>
      )}
      {canShip && (
        <Button
          size="sm"
          onClick={() => {
            setShipOpen(true);
            setError(null);
          }}
        >
          Mark shipped
        </Button>
      )}
      <Modal
        open={manualCancelOpen}
        onClose={() => setManualCancelOpen(false)}
        title={
          status === 'CANCELLED'
            ? 'Verify legacy supplier cancellation'
            : 'Record supplier cancellation confirmation'
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setManualCancelOpen(false)} disabled={busy}>
              Back
            </Button>
            <Button
              variant="danger"
              onClick={recordManualCancellation}
              loading={busy}
              disabled={manualCancelNote.trim().length < 5}
            >
              {status === 'CANCELLED' ? 'Record verification' : 'Record confirmation'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {error && <Alert tone="error">{error}</Alert>}
          <Alert tone="warning" title="This does not contact the supplier">
            {status === 'CANCELLED'
              ? 'This legacy row was marked cancelled before supplier-confirmation tracking existed. Only continue after verifying the supplier confirmed cancellation. This records your attestation without changing the existing local status.'
              : 'Only continue after the supplier has confirmed cancellation outside Zenvora. This records your confirmation, marks the supplier order cancelled, and closes its pending job.'}
          </Alert>
          <Field
            label="Supplier confirmation details"
            required
            hint="At least 5 characters; recorded in the admin audit log."
          >
            {(p) => (
              <Textarea
                {...p}
                value={manualCancelNote}
                onChange={(event) => setManualCancelNote(event.target.value)}
                maxLength={500}
                placeholder="Who confirmed it, and when/reference?"
              />
            )}
          </Field>
        </div>
      </Modal>
      <Modal
        open={shipOpen}
        onClose={() => setShipOpen(false)}
        title="Mark supplier order shipped"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShipOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={ship}
              loading={busy}
              disabled={!carrier.trim() && !trackingNumber.trim()}
            >
              Save & notify customer
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {error && <Alert tone="error">{error}</Alert>}
          <p className="text-sm text-ink-600">
            Use when the supplier shipped but tracking did not arrive automatically (or for manual
            fulfilment). This advances the customer order to SHIPPED and emails tracking details.
          </p>
          <Field label="Carrier" hint="At least one of carrier / tracking number required">
            {(p) => (
              <Input
                {...p}
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                maxLength={120}
                placeholder="e.g. Delhivery"
              />
            )}
          </Field>
          <Field label="Tracking number">
            {(p) => (
              <Input
                {...p}
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                maxLength={120}
              />
            )}
          </Field>
          <Field label="Tracking URL">
            {(p) => (
              <Input
                {...p}
                type="url"
                value={trackingUrl}
                onChange={(e) => setTrackingUrl(e.target.value)}
                maxLength={500}
                placeholder="https://…"
              />
            )}
          </Field>
        </div>
      </Modal>
    </div>
  );
}
