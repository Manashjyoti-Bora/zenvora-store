import { createHash } from 'node:crypto';
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

/**
 * CJ token-class rejection codes on an AUTHENTICATED call that a fresh token
 * can fix. CJ's official troubleshooting for 1600001 ("Invalid API key or
 * access token") is literally "Get new access token".
 * (1600003 is refresh-token specific and already handled inside token();
 * 1600030 is a logout-endpoint error and must never trigger retries.)
 */
const TOKEN_RETRYABLE_CODES = new Set([1600001, 1600002]);

/**
 * Safe, structured failure classes for observability and CJ support tickets.
 * Mapping follows CJ's official global error-code table (ps-code.html):
 * credential = key/account wrong; token = issued token rejected (fresh token
 * can fix); authorization = account/store-level permission (CJ-side).
 */
export type CjFailureClass =
  | 'AUTH_CREDENTIAL_FAILURE'
  | 'AUTH_TOKEN_FAILURE'
  | 'AUTHORIZATION_FAILURE'
  | 'ENDPOINT_FAILURE'
  | 'PARAMETER_FAILURE'
  | 'RATE_LIMIT'
  | 'CJ_SERVER_FAILURE'
  | 'NETWORK_FAILURE';

const CODE_CLASS: Record<number, CjFailureClass> = {
  1600005: 'AUTH_CREDENTIAL_FAILURE', // API key wrong
  1600006: 'AUTH_CREDENTIAL_FAILURE', // developer account not found
  1600007: 'AUTH_CREDENTIAL_FAILURE', // user bound to another developer account
  1601000: 'AUTH_CREDENTIAL_FAILURE', // user not found
  1600001: 'AUTH_TOKEN_FAILURE', // invalid API key or access token
  1600002: 'AUTH_TOKEN_FAILURE', // access token empty
  1600003: 'AUTH_TOKEN_FAILURE', // invalid refresh token
  1600030: 'AUTH_TOKEN_FAILURE', // token invalidation failure
  1600004: 'AUTHORIZATION_FAILURE', // authorization failed / API store not authorized
  1600008: 'AUTHORIZATION_FAILURE',
  1600012: 'AUTHORIZATION_FAILURE',
  1600013: 'AUTHORIZATION_FAILURE', // store info does not exist
  1600100: 'ENDPOINT_FAILURE', // interface offline
  1600101: 'ENDPOINT_FAILURE', // interface not found
  16900202: 'ENDPOINT_FAILURE', // request method not supported
  1600200: 'RATE_LIMIT',
  1600201: 'RATE_LIMIT',
  1600300: 'PARAMETER_FAILURE',
  1600301: 'PARAMETER_FAILURE',
  1600000: 'CJ_SERVER_FAILURE', // system busy
  1608002: 'CJ_SERVER_FAILURE', // warehouse data source transiently unavailable
};

/** Map a CJ response code (or a transport failure) to its safe class. */
export function classifyCjFailure(code: number | null | undefined): CjFailureClass {
  if (code === null || code === undefined || code === 0) return 'NETWORK_FAILURE';
  return CODE_CLASS[code] ?? 'CJ_SERVER_FAILURE';
}

/** CJ documents QPS = 1 for authentication and "consistent with other API
 * endpoints" — pace pagination and the logout→exchange sequence. */
const CJ_QPS_DELAY_MS = 1_100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tokenFingerprint(token: string): string {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

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

/** One safe probe step: codes/flags/timings only — never secret material. */
export interface CjProbeStep {
  ok: boolean;
  code: number | null;
  httpStatus: number | null;
  successFlag: boolean | null;
  resultFlag: boolean | null;
  message: string | null;
  requestId: string | null;
  elapsedMs: number;
}

export interface CjProbeResult {
  apiKeyPresent: boolean;
  apiKeyLength: number | null;
  /** sha256(apiKey) first 12 hex — safe to share with CJ support. */
  apiKeyFingerprint: string | null;
  getAccessToken: CjProbeStep & {
    tokenPresent: boolean;
    tokenFingerprint: string | null;
    tokenExpiryPresent: boolean;
  };
  authenticatedProbe: CjProbeStep & {
    endpoint: 'setting/get';
    /** CJ's own account-authorization read: NO_PERMISSION = not authorized. */
    root: string | null;
    isSandbox: boolean | null;
  };
  myProductQuery: CjProbeStep & {
    total: number | null;
    returned: number | null;
  };
  /** Classification of the first failing step (null when all succeeded). */
  classification: CjFailureClass | null;
  conclusion: string;
  elapsedMs: number;
}

/** Process-local token cache keyed by supplier id (never persisted). */
const tokenCache = new Map<string, TokenEntry>();

/**
 * Per-supplier single-flight guard (process-local). On serverless instances
 * concurrent requests can hit a token rejection simultaneously; without this
 * guard each would logout + re-exchange, invalidating the other's fresh token
 * (CJ logout expires the account's current tokens server-side). All callers
 * arriving during one recovery share that single recovery.
 */
const inFlight = new Map<string, Promise<unknown>>();

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
    if (!supplier.apiKeyEnvVar) {
      // Distinct cause 1: the DB record is missing the env-var NAME.
      throw new UnsupportedSupplierOperation(
        `CJ supplier "${supplier.name}": apiKeyEnvVar is not set on the supplier record. Set it to the NAME of the environment variable holding the CJ API key (e.g. CJ_API_KEY) - never the key itself.`
      );
    }
    if (!this.apiKey) {
      // Distinct cause 2: the named variable is absent/empty in THIS runtime.
      // Never include the value; only the name and presence. Env vars on
      // Vercel are baked in at deploy time, so a freshly added variable also
      // requires a redeploy before the running server can see it.
      throw new UnsupportedSupplierOperation(
        `CJ supplier "${supplier.name}": environment variable ${supplier.apiKeyEnvVar} is not present in this environment (envVarName: ${supplier.apiKeyEnvVar}, valuePresent: false). Add it in Vercel → Settings → Environment Variables (Production) and redeploy; until then catalog sync and automatic CJ forwarding stay disabled.`
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
    // Bounded pagination over CJ My Products: at most 5 pages of ≤100 items
    // (≤500 products per sync). The sync endpoint passes limit:200, which
    // needs two pages; short pages end the loop early so a small catalogue
    // costs exactly one request.
    const cap = Math.max(1, Math.min(opts?.limit ?? 50, 500));
    const pageSize = Math.min(cap, 100);
    const maxPages = 5;
    const out: SupplierProductDto[] = [];
    for (let pageNum = 1; pageNum <= maxPages && out.length < cap; pageNum += 1) {
      const res = await this.get('product/myProduct/query', {
        pageNum: String(pageNum),
        pageSize: String(pageSize),
      });
      const data = this.unwrap<unknown>(res, 'product/myProduct/query');
      const list = Array.isArray(data)
        ? data
        : (((data as Record<string, unknown>)?.list ?? []) as unknown[]);
      for (const item of list) {
        if (out.length >= cap) break;
        out.push(this.mapProduct(item as Record<string, unknown>));
      }
      if (list.length < pageSize) break;
      // CJ documents QPS = 1 ("consistent with other API endpoints"): pace
      // multi-page syncs instead of bursting and tripping 1600200.
      if (out.length < cap && pageNum < maxPages) await sleep(CJ_QPS_DELAY_MS);
    }
    return out;
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

  /** Deduplicate concurrent async recoveries for the same supplier+purpose. */
  private singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = inFlight.get(key);
    if (existing) return existing as Promise<T>;
    const run = fn().finally(() => {
      if (inFlight.get(key) === run) inFlight.delete(key);
    });
    inFlight.set(key, run);
    return run;
  }

  private async token(): Promise<string> {
    // Single-flight: concurrent callers share one cache read / refresh /
    // exchange wave instead of racing (which could invalidate each other).
    return this.singleFlight(`token:${this.supplier.id}`, async () => {
      const cached = tokenCache.get(this.supplier.id);
      if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
      if (cached?.refreshToken) {
        try {
          const refreshed = await this.rawPost('authentication/refreshAccessToken', {
            refreshToken: cached.refreshToken,
          });
          if (this.ok(refreshed)) {
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
    });
  }

  /**
   * Tolerant success check. CJ's documented envelope sets BOTH `success:true`
   * and `result:true` on success, but some endpoint error examples omit the
   * `success` field entirely — never treat a missing flag as failure when the
   * documented result flag or the code says otherwise. (When both flags are
   * absent, fall back to code 200.)
   */
  private ok(res: CjEnvelope): boolean {
    if (res.success === true || res.result === true) return true;
    if (res.success === undefined && res.result === undefined) return res.code === 200;
    return false;
  }

  private storeToken(key: string, res: CjEnvelope<unknown>): TokenEntry {
    if (!this.ok(res)) {
      let message = res.message ?? 'unknown error';
      if (res.code === 1600300 && /email/i.test(message)) {
        // Official code table: 1600300 = "Param error". CJ's auth validator
        // falls back to the legacy email+password grant when the apiKey field
        // arrives EMPTY, so this exact message means the key never reached CJ
        // intact (e.g. an unset/empty env var in THIS runtime) — not that CJ
        // now requires an email parameter (it does not; apiKey is the only
        // documented credential for getAccessToken).
        message +=
          ' — the apiKey value reached CJ empty or unparseable. Verify the environment variable named by apiKeyEnvVar exists and holds the FULL API Key value in this runtime (Admin → Suppliers → diagnostics shows presence, never the value).';
      }
      throw new Error(
        `CJ authentication failed: ${message} (code ${res.code ?? 'n/a'}) [${classifyCjFailure(res.code ?? null)}]`
      );
    }
    const data = (res.data ?? {}) as Record<string, unknown>;
    const accessToken = str(data.accessToken);
    if (!accessToken) throw new Error('CJ authentication returned no accessToken');

    logger.warn(`CJ forensic token received length=${accessToken.length}`, {
      supplier: this.supplier.slug,
      tokenLength: accessToken.length,
      tokenFingerprint: tokenFingerprint(accessToken),
    });
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
    const target = url.toString();
    return this.withTokenRetry(this.request(target, 'GET', undefined), () =>
      this.request(target, 'GET', undefined)
    );
  }

  private async post(path: string, body: unknown): Promise<CjEnvelope> {
    const target = `${API_BASE}/${path}`;
    return this.withTokenRetry(this.request(target, 'POST', body), () =>
      this.request(target, 'POST', body)
    );
  }

  /**
   * Self-heal for CJ's documented 24-hour server-side token cache: when an
   * authenticated call is rejected with a token-class code (1600001/1600002),
   * CJ's own remedy is "Get new access token" — but inside the 24h window the
   * exchange endpoint returns the SAME cached token unless it was explicitly
   * logged out. So: best-effort logout with the rejected token (expires access
   * + refresh tokens server-side) → clear the local cache → exchange a fresh
   * token → retry the original call exactly ONCE. Business errors, network
   * errors and repeated token failures are never retried or hidden.
   */
  private async withTokenRetry(
    first: Promise<CjEnvelope>,
    retry: () => Promise<CjEnvelope>
  ): Promise<CjEnvelope> {
    const res = await first;
    if (
      res.success !== false ||
      typeof res.code !== 'number' ||
      !TOKEN_RETRYABLE_CODES.has(res.code)
    ) {
      return res;
    }
    logger.warn('CJ rejected the access token - re-authenticating once', {
      supplier: this.supplier.slug,
      code: res.code,
    });
    await this.reauthenticate();
    return retry();
  }

  private async reauthenticate(): Promise<void> {
    // Single-flight: if several requests hit the same token rejection, ONE
    // logout+exchange runs; the others await it instead of performing their
    // own logout (which would expire the fresh token the first caller got).
    await this.singleFlight(`reauth:${this.supplier.id}`, async () => {
      const stale = tokenCache.get(this.supplier.id);
      tokenCache.delete(this.supplier.id);
      if (stale) {
        try {
          // Best-effort: expires CJ's server-cached token so the next exchange
          // mints a NEW token instead of returning the same rejected one.
          await this.request(`${API_BASE}/authentication/logout`, 'POST', undefined, stale.token);
        } catch {
          // ignore - the fresh exchange below is what matters
        }
        await sleep(CJ_QPS_DELAY_MS); // CJ auth endpoints: QPS = 1
      }
      await this.token();
    });
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
    return (await this.rawRequest(url, method, body, useToken)).res;
  }

  /** Like request() but also reports HTTP status and elapsed time (for probes). */
  private async rawRequest(
    url: string,
    method: 'GET' | 'POST',
    body: unknown,
    useToken: string | null | undefined = undefined
  ): Promise<{ res: CjEnvelope; httpStatus: number; elapsedMs: number }> {
    const token = useToken === null ? null : (useToken ?? (await this.token()));
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers['CJ-Access-Token'] = token;

    if (token) {
      logger.warn(`CJ forensic token sent length=${token.length}`, {
        supplier: this.supplier.slug,
        tokenLength: token.length,
        tokenFingerprint: tokenFingerprint(token),
        tokenMatchesCache: token === tokenCache.get(this.supplier.id)?.token,
      });
    }
    if (this.config.platformToken) headers.platformToken = this.config.platformToken;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const started = Date.now();
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const httpStatus = response.status;
      const text = await response.text();
      let parsed: CjEnvelope;
      try {
        parsed = text ? (JSON.parse(text) as CjEnvelope) : {};
      } catch {
        // CDN/proxy error pages (HTML) must not surface as confusing
        // "Unexpected token" parse errors.
        return {
          res: {
            success: false,
            code: response.status,
            message: `CJ returned a non-JSON response (HTTP ${response.status})`,
          },
          httpStatus,
          elapsedMs: Date.now() - started,
        };
      }
      if (!response.ok && parsed.success === undefined) {
        return {
          res: { success: false, code: response.status, message: `HTTP ${response.status}` },
          httpStatus,
          elapsedMs: Date.now() - started,
        };
      }
      return { res: parsed, httpStatus, elapsedMs: Date.now() - started };
    } catch (err) {
      const message =
        err instanceof Error
          ? err.name === 'AbortError'
            ? `CJ request timed out after ${DEFAULT_TIMEOUT_MS}ms`
            : err.message
          : 'CJ request failed';
      logger.warn(message, { supplier: this.supplier.slug, url });
      return {
        res: { success: false, code: 0, message },
        httpStatus: 0,
        elapsedMs: Date.now() - started,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // --- Forensic probe (safe; no secret material in the result) ---------------

  /**
   * Production-safe three-step CJ probe for support escalation:
   *  1. getAccessToken — fresh exchange (cache-independent)
   *  2. setting/get — minimal authenticated endpoint that also reads CJ's own
   *     account-authorization view (`root`: NO_PERMISSION means not authorized;
   *     `isSandbox`)
   *  3. product/myProduct/query — the exact catalog-sync endpoint
   * Reports only codes, flags, requestIds, timings and sha256 fingerprints
   * (first 12 hex) — NEVER the API key or token values. Performs no logout and
   * no retries, so running it never invalidates the currently-working token.
   */
  async probe(): Promise<CjProbeResult> {
    const started = Date.now();
    const key = this.apiKey;
    const result: CjProbeResult = {
      apiKeyPresent: Boolean(key),
      apiKeyLength: key ? key.length : null,
      apiKeyFingerprint: fingerprint(key),
      getAccessToken: {
        ok: false, code: null, httpStatus: null, successFlag: null, resultFlag: null,
        message: null, requestId: null, elapsedMs: 0,
        tokenPresent: false, tokenFingerprint: null, tokenExpiryPresent: false,
      },
      authenticatedProbe: {
        ok: false, code: null, httpStatus: null, successFlag: null, resultFlag: null,
        message: null, requestId: null, elapsedMs: 0,
        endpoint: 'setting/get', root: null, isSandbox: null,
      },
      myProductQuery: {
        ok: false, code: null, httpStatus: null, successFlag: null, resultFlag: null,
        message: null, requestId: null, elapsedMs: 0,
        total: null, returned: null,
      },
      classification: null,
      conclusion: '',
      elapsedMs: 0,
    };

    // TEST 1: credential → token exchange.
    let token: string | null = null;
    {
      const { res, httpStatus, elapsedMs } = await this.rawRequest(
        `${API_BASE}/authentication/getAccessToken`,
        'POST',
        { apiKey: key },
        null
      );
      const s = result.getAccessToken;
      s.elapsedMs = elapsedMs;
      s.httpStatus = httpStatus;
      s.code = typeof res.code === 'number' ? res.code : null;
      s.successFlag = res.success ?? null;
      s.resultFlag = res.result ?? null;
      s.message = res.message ?? null;
      s.requestId = res.requestId ?? null;
      const data = (res.data ?? {}) as Record<string, unknown>;
      const access = str(data.accessToken);
      s.tokenPresent = Boolean(access);
      s.tokenFingerprint = fingerprint(access);
      s.tokenExpiryPresent = Boolean(str(data.accessTokenExpiryDate));
      s.ok = this.ok(res) && s.tokenPresent;
      token = access ?? null;
    }

    if (token) {
      // TEST 2: minimal authenticated endpoint + CJ's authorization view.
      {
        const { res, httpStatus, elapsedMs } = await this.rawRequest(
          `${API_BASE}/setting/get`,
          'GET',
          undefined,
          token
        );
        const s = result.authenticatedProbe;
        s.elapsedMs = elapsedMs;
        s.httpStatus = httpStatus;
        s.code = typeof res.code === 'number' ? res.code : null;
        s.successFlag = res.success ?? null;
        s.resultFlag = res.result ?? null;
        s.message = res.message ?? null;
        s.requestId = res.requestId ?? null;
        const data = (res.data ?? {}) as Record<string, unknown>;
        s.root = str(data.root);
        s.isSandbox = typeof data.isSandbox === 'boolean' ? data.isSandbox : null;
        s.ok = this.ok(res);
      }

      // TEST 3: the exact endpoint catalog sync uses.
      {
        const url = new URL(`${API_BASE}/product/myProduct/query`);
        url.searchParams.set('pageNum', '1');
        url.searchParams.set('pageSize', '1');
        const { res, httpStatus, elapsedMs } = await this.rawRequest(
          url.toString(),
          'GET',
          undefined,
          token
        );
        const s = result.myProductQuery;
        s.elapsedMs = elapsedMs;
        s.httpStatus = httpStatus;
        s.code = typeof res.code === 'number' ? res.code : null;
        s.successFlag = res.success ?? null;
        s.resultFlag = res.result ?? null;
        s.message = res.message ?? null;
        s.requestId = res.requestId ?? null;
        const data = (res.data ?? {}) as Record<string, unknown>;
        const list = Array.isArray(data.list)
          ? (data.list as unknown[])
          : Array.isArray(res.data)
            ? (res.data as unknown[])
            : [];
        s.total = typeof data.total === 'number' ? data.total : null;
        s.returned = list.length;
        s.ok = this.ok(res);
      }
    }

    const firstFailure: CjProbeStep | null = !result.getAccessToken.ok
      ? result.getAccessToken
      : !result.authenticatedProbe.ok
        ? result.authenticatedProbe
        : !result.myProductQuery.ok
          ? result.myProductQuery
          : null;
    result.classification = firstFailure ? classifyCjFailure(firstFailure.code) : null;
    result.elapsedMs = Date.now() - started;
    result.conclusion = probeConclusion(result);
    return result;
  }

  private unwrap<T>(res: CjEnvelope<unknown>, op: string): T {
    if (!this.ok(res)) {
      throw new Error(
        `CJ ${op} failed: ${res.message ?? 'unknown error'} (code ${res.code ?? 'n/a'}) [${classifyCjFailure(res.code ?? null)}]`
      );
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

/** Safe fingerprint (sha256 prefix) for support tickets — never reversible. */
function fingerprint(value: string | null | undefined): string | null {
  if (!value) return null;
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
}

/** Human-readable, secret-free verdict for the probe result. */
function probeConclusion(r: CjProbeResult): string {
  if (r.getAccessToken.ok && r.authenticatedProbe.ok && r.myProductQuery.ok) {
    return 'All three CJ probes succeeded: the API key authenticates, the account reads as authorized, and product/myProduct/query responds. There is no CJ-side blocker for catalog sync.';
  }
  if (!r.getAccessToken.ok) {
    return `CJ rejected the credential exchange itself (${r.classification}). Verify the environment variable holds the FULL key of Type "API Key" (CJ also issues MCP tokens, which are not API keys) for the "Zenvora API" app.`;
  }
  if (!r.authenticatedProbe.ok) {
    return `CJ rejected an authenticated setting/get call (${r.classification}) even though a token was issued — account/authorization-level failure on CJ's side. Send the requestId below to CJ support.`;
  }
  if (r.authenticatedProbe.root === 'NO_PERMISSION' || r.authenticatedProbe.isSandbox === true) {
    return `CJ itself reports this account as root=${r.authenticatedProbe.root ?? 'unknown'}, isSandbox=${String(r.authenticatedProbe.isSandbox)} — the token authenticates but the account is NOT fully authorized for API access. This must be fixed on CJ's side (API store authorization).`;
  }
  return `CJ-side endpoint authorization mismatch: the token authenticates and setting/get succeeds (root=${r.authenticatedProbe.root ?? 'unknown'}), but product/myProduct/query still fails (code ${r.myProductQuery.code ?? 'n/a'}). This is not a Zenvora code or token-caching problem — send both requestIds to CJ support and verify the API store "Zenvora Store" authorization for the "Zenvora API" app.`;
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
