'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { Alert } from '@/components/ui/feedback';

export function SupplierOrderActions({
  supplierOrderId,
  status,
}: {
  supplierOrderId: string;
  status: string;
}) {
  const router = useRouter();
  const [shipOpen, setShipOpen] = useState(false);
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canShip = !['SHIPPED', 'DELIVERED', 'CANCELLED'].includes(status);
  const canRetry = ['FAILED', 'REJECTED', 'QUEUED'].includes(status);

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
          <p className="text-sm text-gray-600">
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
