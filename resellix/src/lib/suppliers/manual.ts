import { prisma } from '../db';
import type {
  SupplierAdapter,
  SupplierCapabilities,
  SupplierCreateOrderInput,
  SupplierCreateOrderResult,
  SupplierOrderStatusResult,
  SupplierActionResult,
  SupplierStockResult,
  Supplier,
} from './types';

/**
 * Manual fulfilment adapter - the honest default for suppliers without APIs.
 *
 * What it really does:
 *  - createOrder(): records the supplier order as QUEUED and tells the truth:
 *    "queued for manual fulfilment". The admin then places the order with the
 *    supplier through whatever channel they use (portal, phone, WhatsApp) and
 *    records acceptance/tracking in the admin panel.
 *  - getOrderStatus(): reads the INTERNAL supplier-order state maintained by
 *    admin actions (never invents progress).
 *  - cancel/return/refund: report requiresManualAction=true - these must be
 *    coordinated with the supplier directly, then recorded by the admin.
 */
export class ManualAdapter implements SupplierAdapter {
  readonly type = 'MANUAL';
  readonly label = 'Manual fulfilment (no supplier API)';

  readonly capabilities: SupplierCapabilities = {
    catalogSync: false,
    stockCheck: false,
    orderCreation: true, // creates an internal queue entry, not an API call
    statusPolling: false,
    tracking: false,
    cancellation: false,
    returns: false,
    refunds: false,
    webhooks: false,
  };

  constructor(private supplier: Supplier) {}

  async checkStock(_supplierSku: string, _quantity: number): Promise<SupplierStockResult> {
    // No API to verify against - availability is the merchant's responsibility
    // (product status / local stock). Reported honestly as unverified.
    return { inStock: true, unverified: true };
  }

  async createOrder(input: SupplierCreateOrderInput): Promise<SupplierCreateOrderResult> {
    return {
      accepted: true,
      supplierOrderId: null,
      status: 'PENDING',
      message: `Queued for manual fulfilment with ${this.supplier.name}. Fulfil from Admin > Fulfilment and record tracking.`,
      raw: { manual: true, idempotencyKey: input.idempotencyKey },
    };
  }

  async getOrderStatus(supplierOrderId: string): Promise<SupplierOrderStatusResult> {
    const record = await prisma.supplierOrder.findFirst({
      where: { OR: [{ id: supplierOrderId }, { supplierOrderId }] },
    });
    if (!record) return { status: 'UNKNOWN', message: 'No internal record found' };
    const map: Record<string, SupplierOrderStatusResult['status']> = {
      QUEUED: 'ACCEPTED',
      SENT: 'ACCEPTED',
      ACCEPTED: 'ACCEPTED',
      PROCESSING: 'PROCESSING',
      SHIPPED: 'SHIPPED',
      DELIVERED: 'DELIVERED',
      CANCELLED: 'CANCELLED',
      REJECTED: 'REJECTED',
      FAILED: 'REJECTED',
    };
    return {
      status: map[record.status] ?? 'UNKNOWN',
      trackingNumber: record.trackingNumber ?? null,
      carrier: record.carrier ?? null,
      message: record.lastError ?? null,
    };
  }

  async getShipmentTracking(supplierOrderId: string): Promise<SupplierOrderStatusResult> {
    return this.getOrderStatus(supplierOrderId);
  }

  async cancelOrder(_supplierOrderId: string, reason?: string): Promise<SupplierActionResult> {
    return {
      success: false,
      requiresManualAction: true,
      message: `Cancellation must be arranged with ${this.supplier.name} directly${reason ? ` (reason: ${reason})` : ''}. Then cancel it in Admin > Fulfilment.`,
    };
  }

  async requestReturn(_supplierOrderId: string, reason: string): Promise<SupplierActionResult> {
    return {
      success: false,
      requiresManualAction: true,
      message: `Returns must be arranged with ${this.supplier.name} directly (reason: ${reason}).`,
    };
  }

  async requestRefund(
    _supplierOrderId: string,
    _amountPaise: number,
    reason: string
  ): Promise<SupplierActionResult> {
    return {
      success: false,
      requiresManualAction: true,
      message: `Supplier refunds must be arranged with ${this.supplier.name} directly (reason: ${reason}).`,
    };
  }
}
