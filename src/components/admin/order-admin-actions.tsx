'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Field, Input, Textarea, Select, Checkbox } from '@/components/ui/form';
import { Alert } from '@/components/ui/feedback';
import { formatINR } from '@/lib/money';

interface OrderActionInfo {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  grandTotalPaise: number;
  refundedPaise: number;
  shippingCostPaise: number;
  otherCostPaise: number;
}

type ModalKind = 'cancel' | 'costs' | 'shipment' | 'refund' | null;

export function OrderAdminActions({ order }: { order: OrderActionInfo }) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalKind>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cancelReason, setCancelReason] = useState('');
  const [cancelRefund, setCancelRefund] = useState(true);
  const [cancelForce, setCancelForce] = useState(false);

  const [shippingCost, setShippingCost] = useState((order.shippingCostPaise / 100).toFixed(2));
  const [otherCost, setOtherCost] = useState((order.otherCostPaise / 100).toFixed(2));

  const [shipCarrier, setShipCarrier] = useState('');
  const [shipTracking, setShipTracking] = useState('');
  const [shipUrl, setShipUrl] = useState('');
  const [shipStatus, setShipStatus] = useState('IN_TRANSIT');
  const [shipMessage, setShipMessage] = useState('');

  const refundablePaise = Math.max(0, order.grandTotalPaise - order.refundedPaise);
  const [refundAmount, setRefundAmount] = useState((refundablePaise / 100).toFixed(2));
  const [refundReason, setRefundReason] = useState('');

  const canCancel = !['CANCELLED', 'REFUNDED', 'DELIVERED'].includes(order.status);
  const canCodCollect =
    order.paymentMethod === 'COD' &&
    order.status === 'DELIVERED' &&
    order.paymentStatus === 'COD_PENDING';
  const canRefund =
    ['PAID', 'PARTIALLY_REFUNDED'].includes(order.paymentStatus) && refundablePaise > 0;

  async function call(fn: () => Promise<unknown>, successMsg: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast(successMsg, 'success');
      setModal(null);
      router.refresh();
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : 'Action failed. Please try again.';
      setError(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="print-hide flex flex-wrap gap-2">
      {canCancel && (
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            setModal('cancel');
            setError(null);
          }}
        >
          Cancel order
        </Button>
      )}
      {canCodCollect && (
        <Button
          variant="success"
          size="sm"
          loading={busy}
          onClick={() =>
            call(
              () => apiFetch(`/api/admin/orders/${order.id}/cod-collected`),
              'COD payment marked as collected'
            )
          }
        >
          Mark COD cash collected
        </Button>
      )}
      {canRefund && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setModal('refund');
            setError(null);
          }}
        >
          Issue refund
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setModal('shipment');
          setError(null);
        }}
      >
        Record shipment update
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setModal('costs');
          setError(null);
        }}
      >
        Adjust actual costs
      </Button>

      {/* Cancel */}
      <Modal
        open={modal === 'cancel'}
        onClose={() => setModal(null)}
        title={`Cancel order ${order.orderNumber}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setModal(null)} disabled={busy}>
              Back
            </Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={cancelReason.trim().length < 3}
              onClick={() =>
                call(
                  () =>
                    apiFetch(
                      `/api/admin/orders/${order.id}/cancel${cancelForce ? '?force=1' : ''}`,
                      {
                        body: { reason: cancelReason.trim(), refund: cancelRefund },
                      }
                    ),
                  cancelRefund && ['PAID', 'PARTIALLY_REFUNDED'].includes(order.paymentStatus)
                    ? 'Order cancelled — refund initiated'
                    : 'Order cancelled'
                )
              }
            >
              Confirm cancellation
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Reason (visible in audit log and customer emails)" required>
            {(p) => (
              <Textarea
                {...p}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                maxLength={300}
                placeholder="e.g. Supplier out of stock"
              />
            )}
          </Field>
          {canRefund && (
            <Checkbox
              label={`Refund ${formatINR(refundablePaise)} to the original payment method`}
              checked={cancelRefund}
              onChange={(e) => setCancelRefund(e.target.checked)}
            />
          )}
          <Checkbox
            label="Force cancel (skip state-machine guards — use only when the order is stuck)"
            checked={cancelForce}
            onChange={(e) => setCancelForce(e.target.checked)}
          />
          {cancelForce && (
            <Alert tone="warning">
              Force-cancelling bypasses normal transition rules. Supplier orders already sent are
              NOT recalled automatically — contact the supplier separately if needed.
            </Alert>
          )}
        </div>
      </Modal>

      {/* Costs */}
      <Modal
        open={modal === 'costs'}
        onClose={() => setModal(null)}
        title="Adjust actual costs"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setModal(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              loading={busy}
              onClick={() =>
                call(
                  () =>
                    apiFetch(`/api/admin/orders/${order.id}/costs`, {
                      method: 'PATCH',
                      body: {
                        shippingCost: shippingCost === '' ? null : Number(shippingCost),
                        otherCost: otherCost === '' ? null : Number(otherCost),
                      },
                    }),
                  'Costs updated — profit recalculated'
                )
              }
            >
              Save costs
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {error && <Alert tone="error">{error}</Alert>}
          <p className="text-sm text-gray-600">
            Enter the <strong>actual</strong> courier/handling costs once known (from invoices or
            the supplier portal). Actual profit recalculates immediately. Supplier cost and gateway
            fees are recorded automatically and are not edited here.
          </p>
          <Field label="Actual shipping cost (₹)">
            {(p) => (
              <Input
                {...p}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={shippingCost}
                onChange={(e) => setShippingCost(e.target.value)}
              />
            )}
          </Field>
          <Field label="Other costs (₹)" hint="Packaging, RTO charges, platform fees…">
            {(p) => (
              <Input
                {...p}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={otherCost}
                onChange={(e) => setOtherCost(e.target.value)}
              />
            )}
          </Field>
        </div>
      </Modal>

      {/* Shipment */}
      <Modal
        open={modal === 'shipment'}
        onClose={() => setModal(null)}
        title="Record shipment update"
        wide
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setModal(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              loading={busy}
              onClick={() =>
                call(
                  () =>
                    apiFetch('/api/admin/shipments', {
                      body: {
                        orderId: order.id,
                        carrier: shipCarrier.trim() || null,
                        trackingNumber: shipTracking.trim() || null,
                        trackingUrl: shipUrl.trim() || null,
                        status: shipStatus,
                        message: shipMessage.trim() || null,
                      },
                    }),
                  'Shipment updated — customer notified'
                )
              }
            >
              Save shipment update
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {error && <Alert tone="error">{error}</Alert>}
          <p className="text-sm text-gray-600">
            Use this for manual fulfilment or to correct tracking data. SHIPPED and later statuses
            advance the customer-visible order state; DELIVERED completes the order.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Carrier" hint="e.g. Delhivery, BlueDart, India Post">
              {(p) => (
                <Input
                  {...p}
                  value={shipCarrier}
                  onChange={(e) => setShipCarrier(e.target.value)}
                  maxLength={120}
                />
              )}
            </Field>
            <Field label="Tracking number">
              {(p) => (
                <Input
                  {...p}
                  value={shipTracking}
                  onChange={(e) => setShipTracking(e.target.value)}
                  maxLength={120}
                />
              )}
            </Field>
            <Field label="Tracking URL">
              {(p) => (
                <Input
                  {...p}
                  type="url"
                  value={shipUrl}
                  onChange={(e) => setShipUrl(e.target.value)}
                  maxLength={500}
                  placeholder="https://…"
                />
              )}
            </Field>
            <Field label="Shipment status" required>
              {(p) => (
                <Select {...p} value={shipStatus} onChange={(e) => setShipStatus(e.target.value)}>
                  <option value="PENDING">Pending (label created)</option>
                  <option value="IN_TRANSIT">In transit</option>
                  <option value="OUT_FOR_DELIVERY">Out for delivery</option>
                  <option value="DELIVERED">Delivered</option>
                  <option value="EXCEPTION">Exception (delay/damage)</option>
                  <option value="RETURNED">Returned to sender (RTO)</option>
                </Select>
              )}
            </Field>
          </div>
          <Field label="Status message" hint="Optional note shown in the tracking timeline">
            {(p) => (
              <Input
                {...p}
                value={shipMessage}
                onChange={(e) => setShipMessage(e.target.value)}
                maxLength={300}
              />
            )}
          </Field>
        </div>
      </Modal>

      {/* Refund */}
      <Modal
        open={modal === 'refund'}
        onClose={() => setModal(null)}
        title="Issue refund"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setModal(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={!(Number(refundAmount) > 0) || refundReason.trim().length < 3}
              onClick={() =>
                call(
                  () =>
                    apiFetch('/api/admin/refunds', {
                      body: {
                        orderId: order.id,
                        amount: Number(refundAmount),
                        reason: refundReason.trim(),
                      },
                    }),
                  'Refund submitted to the gateway'
                )
              }
            >
              Refund {refundAmount ? formatINR(Math.round(Number(refundAmount) * 100)) : ''}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {error && <Alert tone="error">{error}</Alert>}
          <Alert tone="info">
            Maximum refundable: <strong>{formatINR(refundablePaise)}</strong> (order total minus
            already-refunded amounts). Refunds go back to the original payment method via the
            gateway; bank processing takes 5–7 business days. TEST-provider payments are recorded
            and settled manually.
          </Alert>
          <Field label="Refund amount (₹)" required hint="Partial refunds are allowed">
            {(p) => (
              <Input
                {...p}
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
              />
            )}
          </Field>
          <Field label="Reason" required>
            {(p) => (
              <Textarea
                {...p}
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                maxLength={300}
                placeholder="e.g. Return approved — damaged item"
              />
            )}
          </Field>
        </div>
      </Modal>
    </div>
  );
}
