import type { Supplier } from '@prisma/client';

/**
 * ============================================================================
 * SupplierAdapter - the fulfilment integration contract
 * ============================================================================
 *
 * The application is NEVER coupled to one supplier. Everything fulfilment-
 * related goes through this interface. Adding a new supplier = implementing
 * this interface (or configuring the generic HTTP-REST adapter) and
 * registering it - no other code changes.
 *
 * Built-in implementations:
 *  - ManualAdapter   production default. No API exists: supplier orders are
 *                    queued and the admin fulfils them manually (place order
 *                    with the supplier by phone/portal/WhatsApp, then record
 *                    tracking in the admin panel). Nothing is faked: statuses
 *                    only change through real human/admin actions.
 *  - HttpRestAdapter ready-for-integration generic REST client. Point it at a
 *                    supplier with a REST API by configuring endpoints +
 *                    credentials (env vars). Contract documented in
 *                    docs/SUPPLIER_API.md.
 *  - DemoAdapter     DEVELOPMENT ONLY (env-gated like TEST payments). Advances
 *                    orders through the full lifecycle with clearly-labelled
 *                    DEMO ids so automation can be demonstrated and E2E-tested
 *                    without credentials. Refused in production.
 */

export interface SupplierStockResult {
  inStock: boolean;
  qty?: number | null;
  /** True when the adapter cannot actually verify stock (e.g. manual). */
  unverified?: boolean;
  raw?: Record<string, unknown>;
}

export interface SupplierOrderItemInput {
  supplierSku: string;
  name: string;
  quantity: number;
  unitCostPaise?: number | null;
}

export interface SupplierAddressInput {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface SupplierCreateOrderInput {
  /** Internal supplier-order row id. */
  internalSupplierOrderId: string;
  /** Idempotency key - adapters MUST forward this to the supplier API when
   *  supported, so retries never create duplicate supplier orders. */
  idempotencyKey: string;
  orderNumber: string;
  currency: string;
  items: SupplierOrderItemInput[];
  shippingAddress: SupplierAddressInput;
  customer: { name?: string | null; email?: string | null; phone?: string | null };
  paymentMethod: 'PREPAID' | 'COD';
  totalPaise?: number | null;
  note?: string | null;
}

export interface SupplierCreateOrderResult {
  accepted: boolean;
  supplierOrderId?: string | null;
  /** Normalised initial status reported by the supplier. */
  status?: 'ACCEPTED' | 'PROCESSING' | 'PENDING';
  message?: string | null;
  raw?: Record<string, unknown>;
}

export interface SupplierTrackingEventInput {
  status: string;
  message?: string | null;
  location?: string | null;
  eventAt?: string | null;
}

export interface SupplierOrderStatusResult {
  status:
    | 'ACCEPTED'
    | 'PROCESSING'
    | 'SHIPPED'
    | 'OUT_FOR_DELIVERY'
    | 'DELIVERED'
    | 'CANCELLED'
    | 'REJECTED'
    | 'UNKNOWN';
  trackingNumber?: string | null;
  carrier?: string | null;
  trackingUrl?: string | null;
  estimatedDeliveryAt?: string | null;
  events?: SupplierTrackingEventInput[];
  message?: string | null;
  raw?: Record<string, unknown>;
}

export interface SupplierActionResult {
  success: boolean;
  referenceId?: string | null;
  message?: string | null;
  /** True when the action is not possible through an API and requires a
   *  manual step by the admin (honest capability reporting). */
  requiresManualAction?: boolean;
  raw?: Record<string, unknown>;
}

export interface SupplierProductDto {
  externalId?: string | null;
  sku: string;
  name?: string | null;
  costPaise?: number | null;
  shippingPaise?: number | null;
  inStock?: boolean | null;
  qty?: number | null;
  raw?: Record<string, unknown>;
}

export interface SupplierCapabilities {
  catalogSync: boolean;
  stockCheck: boolean;
  orderCreation: boolean;
  statusPolling: boolean;
  tracking: boolean;
  cancellation: boolean;
  returns: boolean;
  refunds: boolean;
  webhooks: boolean;
}

export interface SupplierAdapter {
  readonly type: string;
  readonly label: string;
  readonly capabilities: SupplierCapabilities;

  getProducts?(opts?: { limit?: number; cursor?: string }): Promise<SupplierProductDto[]>;
  getProduct?(supplierSku: string): Promise<SupplierProductDto | null>;
  checkStock(supplierSku: string, quantity: number): Promise<SupplierStockResult>;
  createOrder(input: SupplierCreateOrderInput): Promise<SupplierCreateOrderResult>;
  getOrderStatus(supplierOrderId: string): Promise<SupplierOrderStatusResult>;
  getShipmentTracking(supplierOrderId: string): Promise<SupplierOrderStatusResult>;
  cancelOrder(supplierOrderId: string, reason?: string): Promise<SupplierActionResult>;
  requestReturn(supplierOrderId: string, reason: string): Promise<SupplierActionResult>;
  requestRefund(
    supplierOrderId: string,
    amountPaise: number,
    reason: string
  ): Promise<SupplierActionResult>;
}

/** Thrown for operations the supplier integration genuinely cannot perform.
 *  NOT retried by the job runner (retrying cannot make it possible). */
export class UnsupportedSupplierOperation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedSupplierOperation';
  }
}

/** Thrown when fulfilment cannot succeed regardless of retries (e.g. the
 *  supplier says out-of-stock). The runner fails the job immediately. */
export class SupplierRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupplierRejectedError';
  }
}

export type { Supplier };
