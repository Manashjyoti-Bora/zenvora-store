import { logger } from '../logger';
import {
  SupplierRejectedError,
  UnsupportedSupplierOperation,
  type SupplierAdapter,
  type SupplierCapabilities,
  type SupplierActionResult,
  type SupplierCreateOrderInput,
  type SupplierCreateOrderResult,
  type SupplierOrderStatusResult,
  type SupplierProductDto,
  type SupplierStockResult,
} from './types';
import type { Supplier } from '@prisma/client';

/**
 * CJ Dropshipping adapter (official public API v2).
 * https://developers.cjdropshipping.com/en/api/api2/
 *
 * Why CJ: general-catalogue dropshipping (not POD) with a documented public
 * REST API: catalogue/variant/stock queries, order creation, wallet payment,
 * order detail + logistics tracking, and webhook notifications. Free to join,
 * pay-per-order via wallet balance - no upfront platform fee.
 *
 * Security/honesty properties:
 *  - The CJ API key lives ONLY in an environment variable whose NAME is stored
 *    on the supplier record (apiKeyEnvVar, e.g. CJ_API_KEY). Never in the DB.
 *  - Access tokens are exchanged from the key and cached in process memory
 *    until expiry, then refreshed (refreshAccessToken) or re-exchanged.
 *  - CJ costs are USD; conversion to paise uses an EXPLICIT config value
 *    (fxRateInrPerUsd). No hidden exchange rate is ever assumed.
 *  - Inbound CJ webhooks carry no signature we can verify, so they are NEVER
 *    trusted directly: /api/suppliers/cj/webhook only enqueues an
 *    authenticated re-sync (SYNC_SUPPLIER_ORDER) of the order from CJ's API.
 *  - Cancellation/returns/refunds are NOT exposed by CJ's public API v2 index;
 *    the adapter reports those capabilities as false and raises
 *    UnsupportedSupplierOperation so the admin UI routes them to manual
 *    handling instead of pretending automation exists.
 *
 * Supplier record expectations:
 *  - type: CJ
 *  - apiKeyEnvVar: name of the env var holding the CJ API key (My CJ →
 *    Authorization → API → API Key).
 *  - config JSON: { "fxRateInrPerUsd": 88.5, "logisticName": "CJPacket Ordinary",
 *                   "fromCountryCode": "CN", "platformToken": "optional" }
 *  - Product mapping: supplierSku should hold the CJ variant id (vid) or CJ
 *    SKU; the adapter resolves SKUs to vids via the stock endpoint.
 */

const API_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';
const DEFAULT_TIMEOUT_MS = 15_000;

interface CjConfig {
  fxRateInrPerUsd?: number;
  logisticName?: string;
  fromCountryCode?: string;
  platformToken?: string;
}

interface CjEnvelope<T = unknown> {
  code?: number;
  result?: boolean;
  success?: boolean;
  message?: string;
  data?: T;
  requestId?: string;
}

interface TokenEntry {
  token: string;
  expiresAt: number;
  refreshToken: string | null;
}

/** Process-local token cache keyed by supplier id (never persisted). */
const tokenCache = new Map<string, TokenEntry>();

export class CJDropshippingAdapter implements SupplierAdapter {
  readonly type = 'CJ' as const;
  readonly label: string;

  readonly capabilities: SupplierCapabilities = {
    catalogSync: true,
    stockCheck: true,
    orderCreation: true,
    statusPolling: true,
    tracking: true,
    cancellation: false,
    returns: false,
    refunds: false,
    // True in the sense that CJ can push notifications to our trigger-only
    // endpoint; status changes themselves are always re-verified via the API.
    webhooks: true,
  };

  private config: CjConfig;

  constructor(private supplier: Supplier) {
    this.label = `CJ Dropshipping: ${supplier.name}`;
    this.config = (supplier.config ?? {}) as CjConfig;
    if (!this.apiKey) {
      throw new UnsupportedSupplierOperation(
        `CJ supplier "${supplier.name}": apiKeyEnvVar is not set or the named environment variable is missing (e.g. CJ_API_KEY).`
      );
    }
    if (!this.config.fxRateInrPerUsd || this.config.fxRateInrPerUsd <= 0) {
      throw new UnsupportedSupplierOperation(
        `CJ supplier "${supplier.name}": config.fxRateInrPerUsd (INR per 1 USD) must be set so CJ USD costs convert explicitly.`
      );
    }
  }

  private get apiKey(): string | undefined {
    return this.supplier.apiKeyEnvVar ? process.env[this.supplier.apiKeyEnvVar] : undefined;
  }

  // --- Catalogue ------------------------------------------------------------

  async getProducts(opts?: { limit?: number }): Promise<SupplierProductDto[]> {
    const pageSize = Math.min(opts?.limit ?? 50, 100);
    const res = await this.get('product/myProduct/query', {
      pageNum: '1',
      pageSize: String(pageSize),
    });
    const data = this.unwrap<unknown>(res, 'product/myProduct/query');
    const list = Array.isArray(data)
      ? data
      : (((data as Record<string, unknown>)?.list ?? []) as unknown[]);
    return list.slice(0, pageSize).map((item) => this.mapProduct(item as Record<string, unknown>));
  }

  async getProduct(supplierSku: string): Promise<SupplierProductDto | null> {
    const vid = await this.resolveVid(supplierSku);
    if (!vid) return null;
    const res = await this.get('product/variant/queryByVid', { vid });
    if (!res.success) return null;
    const data = this.unwrap<Record<string, unknown>>(res, 'product/variant/queryByVid');
    return {
      externalId: str(data.pid),
      sku: str(data.sku) ?? str(data.vid) ?? supplierSku,
      name: str(data.productName ?? data.name),
      costPaise: this.usdToPaise(firstNum(data, ['variantBuyPrice', 'buyPrice', 'variantSellPrice', 'sellPrice'])),
      inStock: typeof data.stock === 'number' ? data.stock > 0 : undefined,
      qty: typeof data.stock === 'number' ? data.stock : undefined,
      raw: data,
    };
  }

  async checkStock(supplierSku: string, quantity: number): Promise<SupplierStockResult> {
    const vid = await this.resolveVid(supplierSku);
    if (!vid) {
      throw new SupplierRejectedError(`CJ cannot resolve variant/SKU "${supplierSku}"`);
    }
    const res = await this.get('product/stock/queryByVid', { vid });
    const data = this.unwrap<Record<string, unknown>>(res, 'product/stock/queryByVid');
    const inventories = Array.isArray(data.inventories)
      ? (data.inventories as Array<Record<string, unknown>>)
      : [];
    const qty =
      typeof data.stock === 'number'
        ? data.stock
        : typeof data.quantity === 'number'
          ? data.quantity
          : inventories.reduce((sum, inv) => sum + (num(inv.stock) ?? 0), 0);
    const inStock = typeof data.inStock === 'boolean' ? data.inStock : qty >= quantity;
    return { inStock, qty, raw: data };
  }

  // --- Orders ----------------------------------------------------------------

  async createOrder(input: SupplierCreateOrderInput): Promise<SupplierCreateOrderResult> {
    const countryCode = this.countryCode(input.shippingAddress.country);
    const products: Array<{ vid: string; quantity: number; storeLineItemId: string }> = [];
    for (let i = 0; i < input.items.length; i += 1) {
      const item = input.items[i];
      const vid = await this.resolveVid(item.supplierSku);
      if (!vid) {
        throw new SupplierRejectedError(
          `CJ cannot resolve variant/SKU "${item.supplierSku}" - map the product to a CJ vid/SKU first.`
        );
      }
      products.push({
        vid,
        quantity: item.quantity,
        storeLineItemId: `${input.idempotencyKey}:${i}`,
      });
    }

    const body = {
      orderNumber: input.orderNumber,
      shippingZip: input.shippingAddress.postalCode,
      shippingCountry: input.shippingAddress.country,
      shippingCountryCode: countryCode,
      shippingProvince: input.shippingAddress.state,
      shippingCity: input.shippingAddress.city,
      shippingCounty: '',
      shippingPhone: input.shippingAddress.phone,
      shippingCustomerName: input.shippingAddress.fullName,
      shippingAddress: input.shippingAddress.line1,
      shippingAddress2: input.shippingAddress.line2 ?? '',
      taxId: '',
      remark: input.note ?? `Zenvora order ${input.orderNumber} (${input.paymentMethod})`,
      email: input.customer.email ?? '',
      consigneeID: '',
      payType: '',
      shopAmount: '',
      logisticName: this.config.logisticName ?? 'CJPacket Ordinary',
      fromCountryCode: this.config.fromCountryCode ?? 'CN',
      houseNumber: '',
      platform: 'api',
      iossType: '',
      iossNumber: '',
      orderFlow: 1,
      products,
    };

    const res = await this.post('shopping/order/createOrderV2', body);
    let data = (res.data ?? null) as Record<string, unknown> | null;

    if (!res.success) {
      const message = res.message ?? 'unknown error';
      if (/out of stock|insufficient stock|inventory/i.test(message)) {
        throw new SupplierRejectedError(`CJ rejected the order: ${message}`);
      }
      if (!/already|exist|duplicate/i.test(message)) {
        return {
          accepted: false,
          message: `CJ createOrder failed: ${message} (code ${res.code ?? 'n/a'})`,
          raw: (res as unknown as Record<string, unknown>) ?? {},
        };
      }
      // Order number already known to CJ (retry after a partial failure):
      // look it up and continue with the payment step instead of duplicating.
      const listRes = await this.get('shopping/order/list', { orderNumber: input.orderNumber });
      const list = this.unwrap<unknown>(listRes, 'shopping/order/list');
      const rows = Array.isArray(list)
        ? list
        : (((list as Record<string, unknown>)?.list ?? []) as unknown[]);
      data = (rows[0] ?? null) as Record<string, unknown> | null;
      if (!data) {
        return { accepted: false, message: `CJ createOrder failed: ${message}`, raw: {} };
      }
    }

    const supplierOrderId =
      str(data?.orderNumber) ?? str(data?.cjOrderId) ?? str(data?.orderId) ?? input.orderNumber;

    // Wallet payment: CJ debits the supplier wallet; without balance the order
    // stays unpaid. We report that honestly instead of claiming fulfilment.
    const payRes = await this.post('shopping/pay/payBalanceV2', { orderNumber: supplierOrderId });
    if (!payRes.success) {
      const payMessage = payRes.message ?? 'wallet payment failed';
      logger.warn('CJ order created but wallet payment failed', {
        supplierOrderId,
        message: payMessage,
      });
      return {
        accepted: true,
        supplierOrderId,
        status: 'PENDING',
        message: `CJ order ${supplierOrderId} created but wallet payment failed (${payMessage}). Top up the CJ wallet, then retry from Admin → Supplier orders.`,
        raw: { create: data, pay: payRes },
      };
    }

    return {
      accepted: true,
      supplierOrderId,
      status: 'ACCEPTED',
      raw: { create: data, pay: payRes.data ?? null },
    };
  }

  async getOrderStatus(supplierOrderId: string): Promise<SupplierOrderStatusResult> {
    let res = await this.get('shopping/order/getOrderDetail', { orderNumber: supplierOrderId });
    if (!res.success) {
      res = await this.get('shopping/order/getOrderDetail', { orderId: supplierOrderId });
    }
    const data = this.unwrap<Record<string, unknown>>(res, 'shopping/order/getOrderDetail');
    return {
      status: mapCjOrderStatus(str(data.orderStatus) ?? ''),
      trackingNumber: str(data.trackingNumber),
      carrier: str(data.logisticName),
      message: str(data.message),
      raw: data,
    };
  }

  async getShipmentTracking(supplierOrderId: string): Promise<SupplierOrderStatusResult> {
    let res = await this.get('logistic/trackInfo', { orderNumber: supplierOrderId });
    if (!res.success) {
      res = await this.get('logistic/trackInfo', { orderId: supplierOrderId });
    }
    const data = this.unwrap<Record<string, unknown>>(res, 'logistic/trackInfo');
    const eventsRaw = Array.isArray(data.logisticsTrackEvents)
      ? (data.logisticsTrackEvents as Array<Record<string, unknown>>)
      : [];
    const numericStatus = num(data.trackingStatus);
    return {
      status: mapCjTrackingStatus(numericStatus),
      trackingNumber: str(data.trackingNumber),
      carrier: str(data.logisticName),
      events: eventsRaw.slice(0, 50).map((ev) => ({
        status: str(ev.statusDesc) ?? str(ev.activity) ?? 'UPDATE',
        message: str(ev.activity) ?? str(ev.thirdActivity),
        location: str(ev.location) ?? str(ev.thirdLocation),
        eventAt: str(ev.eventTime) ?? str(ev.thirdEventTime),
      })),
      raw: data,
    };
  }

  // --- Not exposed by CJ's public API v2 --------------------------------------

  async cancelOrder(
    _supplierOrderId: string,
    _reason?: string
  ): Promise<SupplierActionResult> {
    throw new UnsupportedSupplierOperation(
      'CJ API v2 does not expose order cancellation; cancel from the CJ dashboard within their window (Admin → Supplier orders shows this as a manual step).'
    );
  }

  async requestReturn(_supplierOrderId: string, _reason: string): Promise<SupplierActionResult> {
    throw new UnsupportedSupplierOperation(
      'CJ API v2 does not expose return requests; handle returns via the CJ dashboard/support.'
    );
  }

  async requestRefund(
    _supplierOrderId: string,
    _amountPaise: number,
    _reason: string
  ): Promise<SupplierActionResult> {
    throw new UnsupportedSupplierOperation(
      'CJ API v2 does not expose refund requests; handle refunds via the CJ dashboard/support.'
    );
  }

  /** Registers CJ ORDER + LOGISTICS webhooks to our trigger-only endpoint. */
  async registerWebhooks(callbackUrl: string): Promise<SupplierActionResult> {
    const res = await this.post('webhook/set', {
      order: { type: 'ENABLE', callbackUrls: [callbackUrl] },
      logistics: { type: 'ENABLE', callbackUrls: [callbackUrl] },
    });
    return {
      success: Boolean(res.success),
      message: res.success ? undefined : res.message ?? 'webhook registration failed',
      raw: (res as unknown as Record<string, unknown>) ?? {},
    };
  }

  // --- Infrastructure ----------------------------------------------------------

  private mapProduct(p: Record<string, unknown>): SupplierProductDto {
    const variants = Array.isArray(p.variantList)
      ? (p.variantList as Array<Record<string, unknown>>)
      : Array.isArray(p.variants)
        ? (p.variants as Array<Record<string, unknown>>)
        : [];
    const first = variants[0] ?? {};
    return {
      externalId: str(p.pid),
      sku: str(p.sku) ?? str(first.sku) ?? str(first.vid) ?? str(p.pid) ?? '',
      name: str(p.productName ?? p.productNameEn ?? p.name),
      costPaise: this.usdToPaise(
        firstNum(p, ['buyPrice', 'sellPrice']) ?? firstNum(first, ['variantBuyPrice', 'variantSellPrice'])
      ),
      qty: typeof p.stock === 'number' ? p.stock : undefined,
      raw: p,
    };
  }

  private usdToPaise(usd: number | null): number | null {
    if (usd === null || !Number.isFinite(usd)) return null;
    return Math.round(usd * (this.config.fxRateInrPerUsd as number) * 100);
  }

  private countryCode(country: string): string {
    const configured = this.config as CjConfig & { shippingCountryCode?: string };
    if (configured.shippingCountryCode) return configured.shippingCountryCode.toUpperCase();
    if (/india/i.test(country)) return 'IN';
    if (/^[A-Za-z]{2}$/.test(country.trim())) return country.trim().toUpperCase();
    throw new UnsupportedSupplierOperation(
      `CJ shipping country "${country}" is not mapped; set config.shippingCountryCode on the supplier record.`
    );
  }

  /** CJ variant ids are GUIDs or long snowflake numbers; SKUs look like CJDS…. */
  private async resolveVid(sku: string): Promise<string | null> {
    if (/^[0-9A-F]{8}-[0-9A-F]{4}-/i.test(sku) || /^\d{15,}$/.test(sku)) return sku;
    const res = await this.get('product/stock/queryBySku', { sku });
    if (!res.success) return null;
    const data = (res.data ?? {}) as Record<string, unknown>;
    return str(data.vid) ?? str(data.variantId) ?? null;
  }

  private async token(): Promise<string> {
    const cached = tokenCache.get(this.supplier.id);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    if (cached?.refreshToken) {
      try {
        const refreshed = await this.rawPost('authentication/refreshAccessToken', {
          refreshToken: cached.refreshToken,
        });
        if (refreshed.success) {
          const entry = this.storeToken(this.supplier.id, refreshed);
          return entry.token;
        }
      } catch {
        // fall through to a fresh token exchange
      }
    }
    const res = await this.rawPost('authentication/getAccessToken', { apiKey: this.apiKey });
    const entry = this.storeToken(this.supplier.id, res);
    return entry.token;
  }

  private storeToken(key: string, res: CjEnvelope<unknown>): TokenEntry {
    if (!res.success) {
      throw new Error(`CJ authentication failed: ${res.message ?? 'unknown error'}`);
    }
    const data = (res.data ?? {}) as Record<string, unknown>;
    const accessToken = str(data.accessToken);
    if (!accessToken) throw new Error('CJ authentication returned no accessToken');
    const parsedExpiry = Date.parse(str(data.accessTokenExpiryDate) ?? '');
    const entry: TokenEntry = {
      token: accessToken,
      expiresAt: Number.isFinite(parsedExpiry) ? parsedExpiry : Date.now() + 2 * 3600_000,
      refreshToken: str(data.refreshToken),
    };
    tokenCache.set(key, entry);
    return entry;
  }

  private async get(path: string, params: Record<string, string>): Promise<CjEnvelope> {
    const url = new URL(`${API_BASE}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return this.request(url.toString(), 'GET', undefined);
  }

  private async post(path: string, body: unknown): Promise<CjEnvelope> {
    return this.request(`${API_BASE}/${path}`, 'POST', body);
  }

  private async rawPost(path: string, body: unknown): Promise<CjEnvelope> {
    return this.request(`${API_BASE}/${path}`, 'POST', body, null);
  }

  private async request(
    url: string,
    method: 'GET' | 'POST',
    body: unknown,
    useToken: string | null | undefined = undefined
  ): Promise<CjEnvelope> {
    const token = useToken === null ? null : (useToken ?? (await this.token()));
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers['CJ-Access-Token'] = token;
    if (this.config.platformToken) headers.platformToken = this.config.platformToken;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      const parsed = text ? (JSON.parse(text) as CjEnvelope) : {};
      if (!response.ok && parsed.success === undefined) {
        return { success: false, code: response.status, message: `HTTP ${response.status}` };
      }
      return parsed;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.name === 'AbortError'
            ? `CJ request timed out after ${DEFAULT_TIMEOUT_MS}ms`
            : err.message
          : 'CJ request failed';
      logger.warn(message, { supplier: this.supplier.slug, url });
      return { success: false, code: 0, message };
    } finally {
      clearTimeout(timer);
    }
  }

  private unwrap<T>(res: CjEnvelope<unknown>, op: string): T {
    if (!res.success && res.code !== 200) {
      throw new Error(`CJ ${op} failed: ${res.message ?? 'unknown error'} (code ${res.code ?? 'n/a'})`);
    }
    return res.data as T;
  }
}

/** CJ order statuses → internal normalised statuses. */
export function mapCjOrderStatus(raw: string): SupplierOrderStatusResult['status'] {
  switch (raw.toUpperCase()) {
    case 'CREATED':
    case 'CONFIRMED':
      return 'ACCEPTED';
    case 'PROCESSING':
    case 'PRINTED':
    case 'PICKING':
    case 'PACKED':
      return 'PROCESSING';
    case 'SHIPPED':
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
    case 'CLOSED':
      return 'REJECTED';
    default:
      return 'UNKNOWN';
  }
}

/** CJ logistics trackingStatus codes → internal normalised statuses. */
export function mapCjTrackingStatus(code: number | null): SupplierOrderStatusResult['status'] {
  if (code === null) return 'UNKNOWN';
  if (code <= 0) return 'UNKNOWN';
  if (code <= 2) return 'PROCESSING';
  if (code <= 9) return 'SHIPPED';
  if (code <= 11) return 'OUT_FOR_DELIVERY';
  if (code === 12) return 'DELIVERED';
  if (code === 13) return 'REJECTED';
  if (code === 14) return 'CANCELLED';
  return 'UNKNOWN';
}

function firstNum(o: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = num(o[k]);
    if (v !== null) return v;
  }
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s.slice(0, 500) : null;
}
