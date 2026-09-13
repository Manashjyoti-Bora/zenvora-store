import crypto from 'node:crypto';
import { prisma } from '../db';
import { isDemoSupplierAllowed } from '../env';
import { randomCode } from '../crypto';
import {
  UnsupportedSupplierOperation,
  type SupplierAdapter,
  type SupplierCapabilities,
  type SupplierCreateOrderInput,
  type SupplierCreateOrderResult,
  type SupplierOrderStatusResult,
  type SupplierActionResult,
  type SupplierStockResult,
  type Supplier,
} from './types';

/**
 * DEMO supplier adapter - DEVELOPMENT/TESTING ONLY (env-gated, refused in
 * production exactly like the TEST payment provider).
 *
 * It simulates a supplier with an automated pipeline: acceptance after a few
 * seconds, then PROCESSING -> SHIPPED (with a tracking number) -> DELIVERED,
 * driven by elapsed time so the polling job advances real statuses through the
 * real code paths. Everything it produces is labelled DEMO (ids start with
 * `SUP-DEMO-`, tracking with `DEMO-`) so demo fulfilment can never be
 * mistaken for real fulfilment.
 */

const PROGRESS_ACCEPTED_SEC = 5;
const PROGRESS_PROCESSING_SEC = 15;
const PROGRESS_SHIPPED_SEC = 30;
const PROGRESS_DELIVERED_SEC = 60;

export class DemoAdapter implements SupplierAdapter {
  readonly type = 'DEMO';
  readonly label = 'DEMO supplier (development only)';

  readonly capabilities: SupplierCapabilities = {
    catalogSync: false,
    stockCheck: true,
    orderCreation: true,
    statusPolling: true,
    tracking: true,
    cancellation: true,
    returns: true,
    refunds: true,
    webhooks: false,
  };

  constructor(private supplier: Supplier) {
    if (!isDemoSupplierAllowed()) {
      throw new UnsupportedSupplierOperation(
        'DEMO supplier adapter is disabled (SUPPLIER_DEMO_MODE is off or this is production)'
      );
    }
  }

  async checkStock(_supplierSku: string, _quantity: number): Promise<SupplierStockResult> {
    return { inStock: true, qty: 100, raw: { demo: true } };
  }

  async createOrder(input: SupplierCreateOrderInput): Promise<SupplierCreateOrderResult> {
    const supplierOrderId = `SUP-DEMO-${randomCode(8)}`;
    return {
      accepted: true,
      supplierOrderId,
      status: 'ACCEPTED',
      message: '[DEMO] Order accepted by simulated supplier',
      raw: { demo: true, idempotencyKey: input.idempotencyKey, items: input.items.length },
    };
  }

  async getOrderStatus(supplierOrderId: string): Promise<SupplierOrderStatusResult> {
    const record = await prisma.supplierOrder.findFirst({
      where: { OR: [{ supplierOrderId }, { id: supplierOrderId }] },
    });
    if (!record) return { status: 'UNKNOWN', message: '[DEMO] Unknown order' };
    if (record.status === 'CANCELLED') {
      return { status: 'CANCELLED', message: '[DEMO] Cancelled' };
    }

    const since = (record.sentAt ?? record.createdAt).getTime();
    const elapsedSec = (Date.now() - since) / 1000;
    const trackingNumber = `DEMO-${demoDigits(record.id, 11)}`;

    if (elapsedSec >= PROGRESS_DELIVERED_SEC) {
      return {
        status: 'DELIVERED',
        trackingNumber,
        carrier: 'Demo Express',
        trackingUrl: null,
        message: '[DEMO] Delivered',
        events: demoTrackingEvents(since, trackingNumber, 'DELIVERED'),
      };
    }
    if (elapsedSec >= PROGRESS_SHIPPED_SEC) {
      return {
        status: 'SHIPPED',
        trackingNumber,
        carrier: 'Demo Express',
        message: '[DEMO] Shipped',
        events: demoTrackingEvents(since, trackingNumber, 'SHIPPED'),
      };
    }
    if (elapsedSec >= PROGRESS_PROCESSING_SEC) {
      return { status: 'PROCESSING', message: '[DEMO] Being packed' };
    }
    if (elapsedSec >= PROGRESS_ACCEPTED_SEC) {
      return { status: 'ACCEPTED', message: '[DEMO] Accepted' };
    }
    return { status: 'ACCEPTED', message: '[DEMO] Received' };
  }

  async getShipmentTracking(supplierOrderId: string): Promise<SupplierOrderStatusResult> {
    return this.getOrderStatus(supplierOrderId);
  }

  async cancelOrder(_supplierOrderId: string, _reason?: string): Promise<SupplierActionResult> {
    return { success: true, message: '[DEMO] Cancellation accepted', raw: { demo: true } };
  }

  async requestReturn(_supplierOrderId: string, _reason: string): Promise<SupplierActionResult> {
    return {
      success: true,
      referenceId: `RET-DEMO-${randomCode(6)}`,
      message: '[DEMO] Return accepted',
      raw: { demo: true },
    };
  }

  async requestRefund(
    _supplierOrderId: string,
    _amountPaise: number,
    _reason: string
  ): Promise<SupplierActionResult> {
    return {
      success: true,
      referenceId: `REF-DEMO-${randomCode(6)}`,
      message: '[DEMO] Refund accepted',
      raw: { demo: true },
    };
  }
}

function demoDigits(seed: string, length: number): string {
  const hash = crypto.createHash('sha256').update(seed).digest();
  let out = '';
  for (let i = 0; i < length; i++) {
    out += String(hash[i % hash.length] % 10);
  }
  return out;
}

function demoTrackingEvents(
  sinceMs: number,
  trackingNumber: string,
  upto: 'SHIPPED' | 'DELIVERED'
) {
  const events = [
    {
      status: 'IN_TRANSIT',
      message: '[DEMO] Picked up from supplier warehouse',
      location: 'Demo Hub, Guwahati',
      eventAt: new Date(sinceMs + PROGRESS_SHIPPED_SEC * 1000).toISOString(),
    },
  ];
  if (upto === 'DELIVERED') {
    events.push({
      status: 'DELIVERED',
      message: `[DEMO] Delivered (tracking ${trackingNumber})`,
      location: 'Customer address',
      eventAt: new Date(sinceMs + PROGRESS_DELIVERED_SEC * 1000).toISOString(),
    });
  }
  return events;
}
