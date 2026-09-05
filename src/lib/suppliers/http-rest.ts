import { prisma } from '../db';
import { env } from '../env';
import { logger, sanitizeForLog } from '../logger';
import { randomToken } from '../crypto';
import { Prisma } from '@prisma/client';
import type { Supplier } from '@prisma/client';
import {
  UnsupportedSupplierOperation,
  type SupplierAdapter,
  type SupplierCapabilities,
  type SupplierCreateOrderInput,
  type SupplierCreateOrderResult,
  type SupplierOrderStatusResult,
  type SupplierActionResult,
  type SupplierStockResult,
  type SupplierProductDto,
} from './types';

/**
 * Generic HTTP-REST supplier adapter (integration-ready).
 *
 * Connect ANY supplier that exposes a JSON REST API by storing endpoint
 * configuration on the supplier record (`config` JSON) and credential env-var
 * NAMES (`apiKeyEnvVar` / `apiSecretEnvVar`) - secrets themselves live only in
 * the environment, never in the database.
 *
 * Expected configuration shape (documented in docs/SUPPLIER_API.md):
 * {
 *   "auth": { "type": "bearer" | "x-api-key" | "basic", "header": "X-Api-Key" },
 *   "timeoutMs": 10000,
 *   "endpoints": {
 *     "products":    { "path": "/catalog", "method": "GET" },
 *     "product":     { "path": "/catalog/{sku}" },
 *     "stock":       { "path": "/stock/{sku}", "response": { "inStock": "available", "qty": "quantity" } },
 *     "createOrder": { "path": "/orders", "method": "POST",
 *                      "response": { "supplierOrderId": "id", "status": "state" } },
 *     "orderStatus": { "path": "/orders/{supplierOrderId}",
 *                      "response": { "status": "state", "trackingNumber": "tracking.no",
 *                                    "carrier": "tracking.carrier", "trackingUrl": "tracking.url" } },
 *     "tracking":    { ... same shape as orderStatus ... },
 *     "cancelOrder": { "path": "/orders/{supplierOrderId}/cancel", "method": "POST" },
 *     "requestReturn": { "path": "/orders/{supplierOrderId}/returns", "method": "POST" },
 *     "requestRefund": { "path": "/orders/{supplierOrderId}/refunds", "method": "POST" }
 *   },
 *   "statusMap": { "confirmed": "ACCEPTED", "in_transit": "SHIPPED", ... }
 * }
 *
 * Every call is logged to `api_logs` with sanitised payloads and durations.
 * Retries are handled by the job runner around these calls; createOrder always
 * sends an `Idempotency-Key` header so safe retries cannot duplicate orders.
 */

interface EndpointConfig {
  path: string;
  method?: string;
  response?: Record<string, string>;
}

interface SupplierHttpConfig {
  auth?: { type?: 'bearer' | 'x-api-key' | 'basic'; header?: string };
  timeoutMs?: number;
  endpoints?: Record<string, EndpointConfig>;
  statusMap?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class HttpRestAdapter implements SupplierAdapter {
  readonly type = 'HTTP_REST';
  readonly label: string;

  private config: SupplierHttpConfig;

  constructor(private supplier: Supplier) {
    this.label = `REST supplier: ${supplier.name}`;
    this.config = (supplier.config ?? {}) as SupplierHttpConfig;
    if (!supplier.baseUrl) {
      throw new UnsupportedSupplierOperation(
        `Supplier "${supplier.name}" has no baseUrl configured`
      );
    }
  }

  get capabilities(): SupplierCapabilities {
    const e = this.config.endpoints ?? {};
    return {
      catalogSync: Boolean(e.products),
      stockCheck: Boolean(e.stock),
      orderCreation: Boolean(e.createOrder),
      statusPolling: Boolean(e.orderStatus),
      tracking: Boolean(e.tracking ?? e.orderStatus),
      cancellation: Boolean(e.cancelOrder),
      returns: Boolean(e.requestReturn),
      refunds: Boolean(e.requestRefund),
      webhooks: false,
    };
  }

  // --- Catalog ----------------------------------------------------------------

  async getProducts(): Promise<SupplierProductDto[]> {
    const res = await this.call('products', { params: {} });
    const bodyRecord = (res.body ?? {}) as Record<string, unknown>;
    const list = Array.isArray(res.body)
      ? res.body
      : ((bodyRecord.items ?? bodyRecord.products ?? []) as unknown[]);
    return list
      .slice(0, 200)
      .map((item) => {
        const o = item as Record<string, unknown>;
        return {
          externalId: str(o.id ?? o.product_id),
          sku: str(o.sku ?? o.product_sku) ?? '',
          name: str(o.name ?? o.title),
          costPaise: moneyField(o.cost ?? o.price ?? o.wholesale_price),
          inStock: typeof o.in_stock === 'boolean' ? o.in_stock : undefined,
          qty: typeof o.quantity === 'number' ? o.quantity : undefined,
          raw: o,
        };
      })
      .filter((p) => p.sku);
  }

  async getProduct(supplierSku: string): Promise<SupplierProductDto | null> {
    const res = await this.call('product', { params: { sku: supplierSku } });
    if (res.status === 404) return null;
    const o = (res.body ?? {}) as Record<string, unknown>;
    return {
      externalId: str(o.id ?? o.product_id),
      sku: str(o.sku) ?? supplierSku,
      name: str(o.name ?? o.title),
      costPaise: moneyField(o.cost ?? o.price),
      raw: o,
    };
  }

  async checkStock(supplierSku: string, quantity: number): Promise<SupplierStockResult> {
    const res = await this.call('stock', { params: { sku: supplierSku } });
    const mapping = this.config.endpoints?.stock?.response ?? {};
    const inStockField = mapping.inStock ?? 'in_stock';
    const qtyField = mapping.qty ?? 'quantity';
    const inStockRaw = pick(res.body, inStockField);
    const qtyRaw = pick(res.body, qtyField);
    const qty = typeof qtyRaw === 'number' ? qtyRaw : null;
    const inStock =
      typeof inStockRaw === 'boolean'
        ? inStockRaw
        : qty !== null
          ? qty >= quantity
          : Boolean(inStockRaw);
    return { inStock, qty, raw: (res.body ?? {}) as Record<string, unknown> };
  }

  // --- Orders ------------------------------------------------------------------

  async createOrder(input: SupplierCreateOrderInput): Promise<SupplierCreateOrderResult> {
    const res = await this.call('createOrder', {
      params: {},
      idempotencyKey: input.idempotencyKey,
      body: {
        idempotency_key: input.idempotencyKey,
        order_number: input.orderNumber,
        currency: input.currency,
        payment_method: input.paymentMethod,
        customer: input.customer,
        shipping_address: input.shippingAddress,
        items: input.items,
        total_paise: input.totalPaise ?? null,
        note: input.note ?? null,
      },
    });
    const mapping = this.config.endpoints?.createOrder?.response ?? {};
    const supplierOrderId = str(pick(res.body, mapping.supplierOrderId ?? 'id'));
    const rawStatus = str(pick(res.body, mapping.status ?? 'status'));
    const accepted = res.status >= 200 && res.status < 300;
    return {
      accepted,
      supplierOrderId,
      status: this.mapCreateStatus(rawStatus),
      message: accepted ? undefined : `Supplier responded HTTP ${res.status}`,
      raw: (res.body ?? {}) as Record<string, unknown>,
    };
  }

  async getOrderStatus(supplierOrderId: string): Promise<SupplierOrderStatusResult> {
    return this.fetchStatus('orderStatus', supplierOrderId);
  }

  async getShipmentTracking(supplierOrderId: string): Promise<SupplierOrderStatusResult> {
    const endpoint = this.config.endpoints?.tracking ? 'tracking' : 'orderStatus';
    return this.fetchStatus(endpoint, supplierOrderId);
  }

  private async fetchStatus(
    endpoint: string,
    supplierOrderId: string
  ): Promise<SupplierOrderStatusResult> {
    const res = await this.call(endpoint, { params: { supplierOrderId } });
    const mapping = this.config.endpoints?.[endpoint]?.response ?? {};
    const rawStatus = str(pick(res.body, mapping.status ?? 'status')) ?? '';
    const eventsRaw = pick(res.body, mapping.events ?? 'tracking_events');
    return {
      status: this.mapStatus(rawStatus),
      trackingNumber: str(pick(res.body, mapping.trackingNumber ?? 'tracking_number')),
      carrier: str(pick(res.body, mapping.carrier ?? 'carrier')),
      trackingUrl: str(pick(res.body, mapping.trackingUrl ?? 'tracking_url')),
      estimatedDeliveryAt: str(pick(res.body, mapping.estimatedDeliveryAt ?? 'estimated_delivery')),
      events: Array.isArray(eventsRaw)
        ? eventsRaw.slice(0, 50).map((e) => {
            const ev = e as Record<string, unknown>;
            return {
              status: str(ev.status) ?? 'UPDATE',
              message: str(ev.message ?? ev.description),
              location: str(ev.location),
              eventAt: str(ev.event_at ?? ev.timestamp ?? ev.time),
            };
          })
        : undefined,
      message: str(pick(res.body, mapping.message ?? 'message')),
      raw: (res.body ?? {}) as Record<string, unknown>,
    };
  }

  async cancelOrder(supplierOrderId: string, reason?: string): Promise<SupplierActionResult> {
    const res = await this.call('cancelOrder', {
      params: { supplierOrderId },
      body: { reason: reason ?? 'Cancelled' },
    });
    return this.actionResult(res.status, res.body);
  }

  async requestReturn(supplierOrderId: string, reason: string): Promise<SupplierActionResult> {
    const res = await this.call('requestReturn', {
      params: { supplierOrderId },
      body: { reason },
    });
    return this.actionResult(res.status, res.body);
  }

  async requestRefund(
    supplierOrderId: string,
    amountPaise: number,
    reason: string
  ): Promise<SupplierActionResult> {
    const res = await this.call('requestRefund', {
      params: { supplierOrderId },
      body: { amount_paise: amountPaise, reason },
    });
    return this.actionResult(res.status, res.body);
  }

  private actionResult(status: number, body: unknown): SupplierActionResult {
    const ok = status >= 200 && status < 300;
    return {
      success: ok,
      referenceId: str(pick(body, 'id')) ?? null,
      message: ok ? undefined : `Supplier responded HTTP ${status}`,
      raw: (body ?? {}) as Record<string, unknown>,
    };
  }

  // --- Infrastructure -----------------------------------------------------------

  private mapCreateStatus(raw?: string | null): 'ACCEPTED' | 'PROCESSING' | 'PENDING' {
    const mapped = this.mapStatus(raw ?? '');
    if (mapped === 'PROCESSING') return 'PROCESSING';
    if (mapped === 'ACCEPTED') return 'ACCEPTED';
    return 'PENDING';
  }

  private mapStatus(raw: string): SupplierOrderStatusResult['status'] {
    const statusMap = this.config.statusMap ?? {};
    const normalized = (statusMap[raw] ?? statusMap[raw.toLowerCase()] ?? raw).toUpperCase();
    switch (normalized) {
      case 'ACCEPTED':
      case 'CONFIRMED':
      case 'PLACED':
        return 'ACCEPTED';
      case 'PROCESSING':
      case 'PACKING':
      case 'PENDING':
        return 'PROCESSING';
      case 'SHIPPED':
      case 'DISPATCHED':
      case 'IN_TRANSIT':
        return 'SHIPPED';
      case 'OUT_FOR_DELIVERY':
        return 'OUT_FOR_DELIVERY';
      case 'DELIVERED':
      case 'COMPLETED':
        return 'DELIVERED';
      case 'CANCELLED':
      case 'CANCELED':
        return 'CANCELLED';
      case 'REJECTED':
      case 'FAILED':
        return 'REJECTED';
      default:
        return 'UNKNOWN';
    }
  }

  private async call(
    endpointName: string,
    opts: { params: Record<string, string>; body?: unknown; idempotencyKey?: string }
  ): Promise<{ status: number; body: unknown }> {
    const endpoint = this.config.endpoints?.[endpointName];
    if (!endpoint?.path) {
      throw new UnsupportedSupplierOperation(
        `Supplier "${this.supplier.name}" has no "${endpointName}" endpoint configured`
      );
    }
    const url = new URL(
      this.supplier.baseUrl!.replace(/\/$/, '') + interpolate(endpoint.path, opts.params)
    );
    const method = (endpoint.method ?? 'GET').toUpperCase();
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Request-Id': randomToken(8),
    };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    this.applyAuth(headers);

    const started = Date.now();
    const requestId = headers['X-Request-Id'];
    let status = 0;
    let body: unknown = null;
    let errorMessage: string | null = null;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url.toString(), {
          method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: controller.signal,
        });
        status = response.status;
        const text = await response.text();
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = { rawText: text.slice(0, 2000) };
        }
        if (status >= 500) errorMessage = `Supplier server error HTTP ${status}`;
        else if (status >= 400) errorMessage = `Supplier client error HTTP ${status}`;
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      errorMessage =
        err instanceof Error
          ? err.name === 'AbortError'
            ? `Supplier request timed out after ${timeoutMs}ms`
            : `Supplier request failed: ${err.message}`
          : 'Supplier request failed';
      logger.warn(errorMessage, { supplier: this.supplier.slug, endpoint: endpointName });
    }

    await this.logApiCall({
      endpoint: url.pathname,
      method,
      status: status || null,
      durationMs: Date.now() - started,
      requestBody: opts.body,
      responseBody: body,
      errorMessage,
      requestId,
    });

    if (errorMessage) throw new Error(errorMessage);
    return { status, body };
  }

  private applyAuth(headers: Record<string, string>): void {
    const auth = this.config.auth;
    // Credentials are read from env vars named on the supplier record. The
    // database stores only the NAME, never the secret.
    const apiKey = this.supplier.apiKeyEnvVar ? process.env[this.supplier.apiKeyEnvVar] : undefined;
    const apiSecret = this.supplier.apiSecretEnvVar
      ? process.env[this.supplier.apiSecretEnvVar]
      : undefined;
    void env;
    if (!auth?.type) return;
    if (auth.type === 'bearer' && apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    } else if (auth.type === 'x-api-key' && apiKey) {
      headers[auth.header ?? 'X-Api-Key'] = apiKey;
      if (apiSecret) headers[`${auth.header ?? 'X-Api-Key'}-Secret`] = apiSecret;
    } else if (auth.type === 'basic' && apiKey) {
      headers.Authorization = `Basic ${Buffer.from(`${apiKey}:${apiSecret ?? ''}`).toString('base64')}`;
    }
  }

  private async logApiCall(params: {
    endpoint: string;
    method: string;
    status: number | null;
    durationMs: number;
    requestBody?: unknown;
    responseBody?: unknown;
    errorMessage?: string | null;
    requestId: string;
  }): Promise<void> {
    try {
      await prisma.apiLog.create({
        data: {
          direction: 'OUTBOUND',
          service: `supplier:${this.supplier.slug}`,
          endpoint: params.endpoint,
          method: params.method,
          statusCode: params.status,
          durationMs: params.durationMs,
          requestBody: (params.requestBody
            ? sanitizeForLog(params.requestBody)
            : Prisma.DbNull) as Prisma.InputJsonValue,
          responseBody: (params.responseBody
            ? sanitizeForLog(params.responseBody)
            : Prisma.DbNull) as Prisma.InputJsonValue,
          errorMessage: params.errorMessage ?? null,
          supplierId: this.supplier.id,
          requestId: params.requestId,
        },
      });
    } catch {
      // Logging must never break the call itself.
    }
  }
}

function interpolate(path: string, params: Record<string, string>): string {
  return path.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(params[key] ?? ''));
}

/** Dot-path getter: pick(body, "tracking.number"). */
function pick(body: unknown, path: string): unknown {
  if (!path) return undefined;
  let cur: unknown = body;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s.slice(0, 500) : null;
}

function moneyField(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.round(v * 100);
}
