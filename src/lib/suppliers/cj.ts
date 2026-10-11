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

/**
 * True when an envelope means the request MAY have been processed even
 * though we have no usable response — i.e. the outcome is UNCERTAIN and the
 * order must be reconciled (by order number) before any resubmission:
 *  - code 0  → transport failure: network error, timeout, non-JSON body.
 *  - 5xx     → CJ/CDN server errors (the request may have been handled).
 * Explicit CJ business rejections carry 5-digit CJ codes (16xxxxx/18xxxxx)
 * and are never uncertain; 4xx with a parsed CJ envelope is a definite no.
 */
export function isUncertainTransportFailure(res: { code?: number | null }): boolean {
  if (typeof res.code !== 'number') return true; // missing code = unknown envelope
  if (res.code === 0) return true;
  return res.code >= 500 && res.code <= 599;
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
    /**
     * Character count of the token CJ returned. Compare against CJ's
     * documented length (~593 for current tokens) — a value of exactly 500
     * is the signature of truncation in the exchange path.
     */
    tokenLength: number | null;
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
    listKey?: string | null;
    dataKeys?: string[];
    firstItemKeys?: string[];
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
    const seenSkus = new Set<string>();
    const seenExternalIds = new Set<string>();

    for (let pageNum = 1; pageNum <= maxPages && out.length < cap; pageNum += 1) {
      const res = await this.get('product/myProduct/query', {
        pageNum: String(pageNum),
        pageNumber: String(pageNum),
        pageSize: String(pageSize),
      });
      const data = this.unwrap<unknown>(res, 'product/myProduct/query');
      const page = extractCjProductPage(data);

      // Safe structural log: status/code/envelope keys/counts only, never
      // credentials or raw payload values.
      logger.info('CJ myProduct/query page received', {
        supplier: this.supplier.slug,
        pageNum,
        code: res.code ?? null,
        requestId: res.requestId ?? null,
        dataType: page.dataType,
        dataKeys: page.dataKeys,
        listKey: page.listKey,
        firstItemKeys: page.firstItemKeys,
        totalReported: page.total,
        itemCount: page.items.length,
      });

      for (const item of page.items) {
        if (out.length >= cap) break;
        const dto = this.mapProduct(item);
        const skuKey = dto.sku ? dto.sku.toLowerCase() : '';
        const extKey = dto.externalId ? dto.externalId.toLowerCase() : '';
        if (skuKey && seenSkus.has(skuKey)) continue;
        if (extKey && seenExternalIds.has(extKey)) continue;
        if (skuKey) seenSkus.add(skuKey);
        if (extKey) seenExternalIds.add(extKey);
        out.push(dto);
      }

      if (page.items.length === 0) break;
      if (page.totalPages !== null && page.totalPages > 0 && pageNum >= page.totalPages) break;
      if (page.total !== null && page.total >= 0 && out.length >= page.total) break;
      const effectivePageSize =
        page.pageSize !== null && page.pageSize > 0
          ? Math.min(pageSize, page.pageSize)
          : pageSize;
      if (page.items.length < effectivePageSize) break;

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
    const stock = num(data.stock ?? data.storageNum ?? data.inventoryNum);
    return {
      externalId: str(data.productId ?? data.pid ?? data.id),
      sku: str(data.variantSku ?? data.sku ?? data.vid) ?? supplierSku,
      name: str(data.nameEn ?? data.productNameEn ?? data.productName ?? data.variantNameEn ?? data.name),
      costPaise: this.usdToPaise(
        firstUsd(data, ['variantBuyPrice', 'buyPrice', 'variantSellPrice', 'sellPrice', 'price'])
      ),
      inStock: stock !== null ? stock > 0 : undefined,
      qty: stock !== null ? stock : undefined,
      raw: data,
    };
  }

  async checkStock(supplierSku: string, quantity: number): Promise<SupplierStockResult> {
    const vid = await this.resolveVid(supplierSku);
    if (!vid) {
      throw new SupplierRejectedError(`CJ cannot resolve variant/SKU "${supplierSku}"`);
    }
    const res = await this.get('product/stock/queryByVid', { vid });
    const rawData = this.unwrap<unknown>(res, 'product/stock/queryByVid');
    const data = (Array.isArray(rawData) ? {} : (rawData ?? {})) as Record<string, unknown>;
    const inventories = Array.isArray(rawData)
      ? (rawData as Array<Record<string, unknown>>)
      : Array.isArray(data.inventories)
        ? (data.inventories as Array<Record<string, unknown>>)
        : [];
    const directStock = num(data.stock ?? data.quantity ?? data.totalInventoryNum ?? data.storageNum);
    const qty =
      directStock !== null
        ? directStock
        : inventories.reduce(
            (sum, inv) =>
              sum +
              (num(inv.stock ?? inv.totalInventoryNum ?? inv.cjInventoryNum ?? inv.storageNum ?? inv.quantity) ??
                0),
            0
          );
    const inStock = typeof data.inStock === 'boolean' ? data.inStock : qty >= quantity;
    return { inStock, qty, raw: Array.isArray(rawData) ? { inventories: rawData } : data };
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

    if (!res.success) {
      const message = res.message ?? 'unknown error';
      if (/out of stock|insufficient stock|inventory/i.test(message)) {
        throw new SupplierRejectedError(`CJ rejected the order: ${message}`);
      }
      if (/already|exist|duplicate/i.test(message)) {
        // Order number already known to CJ (retry after a partial failure):
        // look it up and continue with the payment step instead of duplicating.
        const lookup = await this.lookupOrderByNumber(input.orderNumber);
        if (!lookup.found) {
          // CJ claimed the order exists but the lookup saw no rows — do not
          // guess. Park for admin review with an explicit instruction.
          return {
            accepted: false,
            failureClass: 'UNCERTAIN',
            message: `CJ reported “${message}” for order ${input.orderNumber}, but the reconciliation lookup returned no rows. Verify in the CJ dashboard, then use Admin → Supplier orders → Retry (it reconciles by order number).`,
            raw: {},
          };
        }
        return this.settleExistingOrder(lookup.data!, input, 'reconciled after “already exists” response');
      }
      if (isUncertainTransportFailure(res)) {
        // UNCERTAIN OUTCOME: a transport failure (timeout / network /
        // non-JSON / HTTP 5xx) means the request MAY have reached CJ and
        // been processed. Reconcile by our order number FIRST — never
        // blindly resubmit (that is how duplicate supplier orders happen).
        const lookup = await this.lookupOrderByNumber(input.orderNumber);
        if (lookup.found) {
          // The first request did create the order — adopt it and settle,
          // exactly like the duplicate path.
          return this.settleExistingOrder(lookup.data!, input, 'reconciled after a createOrder transport failure');
        }
        if (lookup.determined) {
          // CJ answered definitively: the order does not exist, so the
          // request was not processed. Resubmission is safe — surface it as
          // a TRANSIENT error so the job runner retries with backoff.
          throw new Error(
            `CJ createOrder transport failure (${message}, code ${res.code ?? 'n/a'}); reconciliation confirmed no order exists — retry is safe`
          );
        }
        // The reconciliation itself could not reach CJ: the outcome is
        // UNKNOWN. Park for explicit admin review — never auto-resubmit.
        return {
          accepted: false,
          failureClass: 'UNCERTAIN',
          message: `CJ createOrder failed with a transport error (${message}, code ${res.code ?? 'n/a'}) and the reconciliation lookup could not determine the outcome — it is UNKNOWN whether order ${input.orderNumber} exists at CJ. Check the CJ dashboard; if the order exists there, use Admin → Supplier orders → Retry (it reconciles by order number and will adopt it); if it does not, Retry will create it.`,
          raw: (res as unknown as Record<string, unknown>) ?? {},
        };
      }
      // Explicit business rejection (CJ answered with a business code):
      // resubmitting the same request will not help.
      return {
        accepted: false,
        failureClass: 'BUSINESS_REJECTION',
        message: `CJ createOrder failed: ${message} (code ${res.code ?? 'n/a'})`,
        raw: (res as unknown as Record<string, unknown>) ?? {},
      };
    }

    return this.settleExistingOrder((res.data ?? {}) as Record<string, unknown>, input);
  }

  /**
   * Reconciliation primitive: look up our order number at CJ. Tri-state on
   * purpose — a failed lookup is NOT "not found":
   *  - found:      CJ has the order (first row returned).
   *  - determined: CJ answered normally; `found` says the truth.
   *  - undetermined: the lookup itself failed (transport/auth) — the
   *    outcome is UNKNOWN and callers must treat it as such.
   */
  private async lookupOrderByNumber(
    orderNumber: string
  ): Promise<{ found: boolean; determined: boolean; data: Record<string, unknown> | null }> {
    const listRes = await this.get('shopping/order/list', { orderNumber });
    if (!listRes.success) {
      return { found: false, determined: false, data: null };
    }
    const list = this.unwrap<unknown>(listRes, 'shopping/order/list');
    const rows = Array.isArray(list)
      ? list
      : (((list as Record<string, unknown>)?.list ?? []) as unknown[]);
    const row = (rows[0] ?? null) as Record<string, unknown> | null;
    return { found: Boolean(row), determined: true, data: row };
  }

  /**
   * Adopt a CJ order row that is known to exist (fresh creation, the
   * “already exists” duplicate response, or post-timeout reconciliation):
   * extract the CJ order id, settle from the CJ wallet, and report the
   * honest outcome. A wallet-payment failure is accepted+PENDING (never
   * hidden) so the admin can top up and retry.
   */
  private async settleExistingOrder(
    data: Record<string, unknown>,
    input: SupplierCreateOrderInput,
    note?: string
  ): Promise<SupplierCreateOrderResult> {
    const supplierOrderId =
      str(data.orderNumber) ?? str(data.cjOrderId) ?? str(data.orderId) ?? input.orderNumber;
    const suffix = note ? ` [${note}]` : '';

    // Wallet payment: CJ debits the supplier wallet; without balance the
    // order stays unpaid. We report that honestly instead of claiming
    // fulfilment.
    const payRes = await this.post('shopping/pay/payBalanceV2', { orderNumber: supplierOrderId });
    if (!payRes.success) {
      const payMessage = payRes.message ?? 'wallet payment failed';
      logger.warn('CJ order exists but wallet payment failed', {
        supplierOrderId,
        message: payMessage,
        note,
      });
      return {
        accepted: true,
        supplierOrderId,
        status: 'PENDING',
        message: `CJ order ${supplierOrderId} exists but wallet payment failed (${payMessage}). Top up the CJ wallet, then retry from Admin → Supplier orders.${suffix}`,
        raw: { order: data, pay: payRes },
      };
    }

    return {
      accepted: true,
      supplierOrderId,
      status: 'ACCEPTED',
      raw: { order: data, pay: payRes.data ?? null },
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
    const externalId = str(p.productId ?? p.pid ?? p.cjProductId ?? p.id);
    const sku =
      str(p.sku) ??
      str(p.productSku) ??
      str(p.variantSku) ??
      str(p.vid) ??
      str(first.variantSku) ??
      str(first.sku) ??
      str(first.vid) ??
      externalId ??
      '';
    const nameFromSet = Array.isArray(p.productNameSet) ? str(p.productNameSet[0]) : null;
    const name =
      str(p.nameEn) ??
      str(p.productNameEn) ??
      str(p.productName) ??
      str(p.name) ??
      str(p.title) ??
      nameFromSet;

    let unitUsd =
      firstUsd(p, ['buyPrice', 'sellPrice', 'discountPrice', 'nowPrice', 'price']) ??
      firstUsd(first, ['variantBuyPrice', 'variantSellPrice', 'buyPrice', 'sellPrice', 'price']);
    let shippingUsd =
      firstUsd(p, ['freightTrial', 'shippingCost', 'postage', 'logisticPrice']) ??
      firstUsd(first, ['freightTrial', 'shippingCost', 'postage']);

    // In CJ product/myProduct/query, totalPrice = sellPrice + freightTrial.
    // Fall back to totalPrice if sellPrice/buyPrice is absent, subtracting
    // freightTrial when present so shipping is not double-counted.
    if (unitUsd === null) {
      const totalUsd = firstUsd(p, ['totalPrice']);
      if (totalUsd !== null) {
        if (shippingUsd !== null && totalUsd >= shippingUsd) {
          unitUsd = Number((totalUsd - shippingUsd).toFixed(4));
        } else {
          unitUsd = totalUsd;
          shippingUsd = null;
        }
      }
    }

    const stockNum = num(
      p.stock ?? p.storageNum ?? p.inventoryNum ?? p.totalInventoryNum ?? first.stock
    );
    const qty = stockNum !== null ? Math.max(0, Math.trunc(stockNum)) : undefined;
    const inStock =
      typeof p.inStock === 'boolean'
        ? p.inStock
        : qty !== undefined
          ? qty > 0
          : undefined;

    return {
      externalId,
      sku,
      name,
      costPaise: this.usdToPaise(unitUsd),
      shippingPaise: shippingUsd !== null ? this.usdToPaise(shippingUsd) : undefined,
      inStock,
      qty,
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
    const raw = res.data;
    const data = (
      Array.isArray(raw) ? (raw[0] ?? {}) : (raw ?? {})
    ) as Record<string, unknown>;
    const firstInv = Array.isArray(data.inventories)
      ? ((data.inventories[0] ?? {}) as Record<string, unknown>)
      : {};
    return (
      str(data.vid) ??
      str(data.variantId) ??
      str(firstInv.vid) ??
      str(firstInv.variantId) ??
      null
    );
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
    // REGRESSION FIX (production 401 / code 1600001): keep the token EXACTLY
    // as CJ returned it. It previously passed through str(), which caps
    // strings at 500 chars — CJ's 593-char token was cached and sent
    // truncated, so every authenticated call failed. Credential material
    // never passes through display helpers.
    const accessToken = credentialString(data.accessToken);
    if (!accessToken) throw new Error('CJ authentication returned no accessToken');

    // Forensic evidence, measured on the RAW value (pre-processing) so
    // "what CJ sent" is distinguishable from "what we will send". Context
    // keys are named without 'token' so the logger's credential-key
    // redaction does not turn the values into [REDACTED].
    logger.warn(`CJ forensic token received length=${accessToken.length}`, {
      supplier: this.supplier.slug,
      credentialLength: accessToken.length,
      credentialFingerprint: tokenFingerprint(accessToken),
    });
    warnIfImplausibleToken(accessToken, this.supplier.slug);

    const expiryRaw = data.accessTokenExpiryDate;
    const parsedExpiry = Date.parse(typeof expiryRaw === 'string' ? expiryRaw : '');
    const entry: TokenEntry = {
      token: accessToken,
      expiresAt: Number.isFinite(parsedExpiry) ? parsedExpiry : Date.now() + 2 * 3600_000,
      // Refresh tokens get the same exact treatment: a truncated refresh
      // token silently breaks the refresh path (1600003) and forces a
      // fresh exchange — CJ's auth endpoint is rate-limited to QPS 1.
      refreshToken: credentialString(data.refreshToken),
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
      // Per-request forensic line. Steady state is a quiet info log; it
      // escalates to WARN when the length carries a truncation signature
      // (exactly 500 — the production 1600001 incident value — or outside
      // the plausible range), so a regression stands out in prod logs.
      // Comparing outgoing vs cached (matchesCache) localises any
      // transformation between cache store and header construction.
      const len = token.length;
      const suspicious = len === 500 || len < 100 || len > 10_000;
      const context = {
        supplier: this.supplier.slug,
        credentialLength: len,
        credentialFingerprint: tokenFingerprint(token),
        matchesCache: token === tokenCache.get(this.supplier.id)?.token,
      };
      if (suspicious) {
        logger.warn(
          `CJ forensic token sent length=${len} (SUSPICIOUS — 500 is the known truncation signature)`,
          context
        );
      } else {
        logger.info(`CJ forensic token sent length=${len}`, context);
      }
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
        tokenLength: null,
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
      // Exact token (credentialString, NOT str): the probe authenticates
      // steps 2–3 with this value, so a truncated token would make the
      // "safe diagnostic" fail with the same 1600001 as production.
      const access = credentialString(data.accessToken);
      s.tokenPresent = Boolean(access);
      s.tokenFingerprint = fingerprint(access);
      s.tokenLength = access ? access.length : null;
      s.tokenExpiryPresent =
        typeof data.accessTokenExpiryDate === 'string' && data.accessTokenExpiryDate.length > 0;
      s.ok = this.ok(res) && s.tokenPresent;
      token = access;
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
        url.searchParams.set('pageNumber', '1');
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
        const page = extractCjProductPage(res.data);
        s.total = page.total;
        s.returned = page.items.length;
        s.listKey = page.listKey;
        s.dataKeys = page.dataKeys;
        s.firstItemKeys = page.firstItemKeys;
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
    const total = r.myProductQuery.total ?? r.myProductQuery.returned ?? 0;
    const returned = r.myProductQuery.returned ?? 0;
    if (total === 0 && returned === 0) {
      return 'All three CJ probes succeeded (no CJ-side blocker for auth or endpoint access), but product/myProduct/query returned 0 products (total=0, returned=0). Verify products are added under My Products in the CJ account bound to this API key.';
    }
    return `All three CJ probes succeeded: the API key authenticates, the account reads as authorized, and product/myProduct/query returned ${returned} item(s) (total=${total}). There is no CJ-side blocker for catalog sync.`;
  }
  if (!r.getAccessToken.ok) {
    return `CJ rejected the credential exchange itself (${r.classification}). Verify the environment variable holds the FULL key of Type "API Key" (CJ also issues MCP tokens, which are not API keys) for the "Zenvora API" app.`;
  }
  if (!r.authenticatedProbe.ok) {
    const len = r.getAccessToken.tokenLength;
    const lenNote =
      len === null
        ? ''
        : ` Token received from CJ: ${len} chars` +
          (len === 500
            ? ' — exactly the 500-char truncation signature (CJ issues ~593-char tokens); if this persists after the credentialString fix, the truncation is on the CJ side.'
            : len !== 593
              ? ` (CJ currently issues ~593-char tokens — a mismatch worth sending to CJ support).`
              : ' (matches the current ~593-char CJ token length, so the token arrived intact).');
    return `CJ rejected an authenticated setting/get call (${r.classification}) even though a token was issued.${lenNote} Send the requestId below to CJ support.`;
  }
  if (r.authenticatedProbe.root === 'NO_PERMISSION' || r.authenticatedProbe.isSandbox === true) {
    return `CJ itself reports this account as root=${r.authenticatedProbe.root ?? 'unknown'}, isSandbox=${String(r.authenticatedProbe.isSandbox)} — the token authenticates but the account is NOT fully authorized for API access. This must be fixed on CJ's side (API store authorization).`;
  }
  return `CJ-side endpoint authorization mismatch: the token authenticates and setting/get succeeds (root=${r.authenticatedProbe.root ?? 'unknown'}), but product/myProduct/query still fails (code ${r.myProductQuery.code ?? 'n/a'}). This is not a Zenvora code or token-caching problem — send both requestIds to CJ support and verify the API store "Zenvora Store" authorization for the "Zenvora API" app.`;
}

export interface CjExtractedPage {
  items: Array<Record<string, unknown>>;
  listKey: string;
  dataType: string;
  dataKeys: string[];
  firstItemKeys: string[];
  total: number | null;
  pageNumber: number | null;
  pageSize: number | null;
  totalPages: number | null;
}

const CJ_PAGE_ARRAY_KEYS = [
  'content',
  'list',
  'records',
  'productList',
  'products',
  'items',
  'rows',
] as const;

/**
 * Normalise CJ's product pagination envelopes.
 *
 * Official CJ API v2 `GET /product/myProduct/query` returns a Spring Page
 * envelope inside `data`:
 *   { pageSize, pageNumber, totalRecords, totalPages, content: [...] }
 * whereas `/product/list` and `/shopping/order/list` return:
 *   { pageNum, pageSize, total, list: [...] }
 * and some responses return a bare array `data: [...]` or nest `productList`
 * inside `content` blocks (`listV2` style).
 */
export function extractCjProductPage(rawData: unknown): CjExtractedPage {
  if (Array.isArray(rawData)) {
    const items = flattenCjProductItems(rawData);
    return {
      items,
      listKey: 'rootArray',
      dataType: 'array',
      dataKeys: [],
      firstItemKeys: items[0] ? Object.keys(items[0]).slice(0, 25) : [],
      total: null,
      pageNumber: null,
      pageSize: null,
      totalPages: null,
    };
  }

  if (!rawData || typeof rawData !== 'object') {
    return {
      items: [],
      listKey: 'none',
      dataType: rawData === null ? 'null' : typeof rawData,
      dataKeys: [],
      firstItemKeys: [],
      total: null,
      pageNumber: null,
      pageSize: null,
      totalPages: null,
    };
  }

  const obj = rawData as Record<string, unknown>;
  const dataKeys = Object.keys(obj).slice(0, 25);
  let target: Record<string, unknown> = obj;
  let prefix = '';

  // Support one level of wrapper (`data.data` or `data.page`) if CJ nests the page object.
  const hasDirectArray = CJ_PAGE_ARRAY_KEYS.some((k) => Array.isArray(obj[k]));
  if (!hasDirectArray) {
    for (const nestedKey of ['data', 'page', 'result'] as const) {
      const nested = obj[nestedKey];
      if (Array.isArray(nested)) {
        const items = flattenCjProductItems(nested);
        return {
          items,
          listKey: `${nestedKey}[]`,
          dataType: 'object',
          dataKeys,
          firstItemKeys: items[0] ? Object.keys(items[0]).slice(0, 25) : [],
          total:
            num(obj.totalRecords ?? obj.total ?? obj.totalCount ?? obj.count) ?? items.length,
          pageNumber: num(obj.pageNumber ?? obj.pageNum),
          pageSize: num(obj.pageSize ?? obj.size),
          totalPages: num(obj.totalPages ?? obj.pages),
        };
      }
      if (nested && typeof nested === 'object') {
        target = nested as Record<string, unknown>;
        prefix = `${nestedKey}.`;
        break;
      }
    }
  }

  let listKey = 'none';
  let rawItems: unknown[] = [];
  for (const key of CJ_PAGE_ARRAY_KEYS) {
    if (Array.isArray(target[key])) {
      rawItems = target[key] as unknown[];
      listKey = `${prefix}${key}`;
      break;
    }
  }

  const items = flattenCjProductItems(rawItems);
  const total =
    num(target.totalRecords ?? target.total ?? target.totalCount ?? target.count) ??
    num(obj.totalRecords ?? obj.total ?? obj.totalCount ?? obj.count);
  const pageNumber =
    num(target.pageNumber ?? target.pageNum) ?? num(obj.pageNumber ?? obj.pageNum);
  const pageSize = num(target.pageSize ?? target.size) ?? num(obj.pageSize ?? obj.size);
  const totalPages = num(target.totalPages ?? target.pages) ?? num(obj.totalPages ?? obj.pages);

  return {
    items,
    listKey,
    dataType: 'object',
    dataKeys,
    firstItemKeys: items[0] ? Object.keys(items[0]).slice(0, 25) : [],
    total,
    pageNumber,
    pageSize,
    totalPages,
  };
}

function flattenCjProductItems(rawItems: unknown[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const entry of rawItems) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const rec = entry as Record<string, unknown>;
    const hasProductIdentity =
      rec.productId !== undefined ||
      rec.pid !== undefined ||
      rec.sku !== undefined ||
      rec.productSku !== undefined ||
      rec.vid !== undefined ||
      rec.nameEn !== undefined ||
      rec.productName !== undefined ||
      rec.productNameEn !== undefined;
    if (!hasProductIdentity && Array.isArray(rec.productList)) {
      for (const sub of rec.productList) {
        if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
          out.push(sub as Record<string, unknown>);
        }
      }
      continue;
    }
    out.push(rec);
  }
  return out;
}

/**
 * Parse a CJ USD price value. Handles numbers (`8.79`), numeric strings
 * (`"8.79"`, `"$8.79"`), and CJ multi-variant price range strings
 * (`"8.79 - 12.50"`, `"8.79 -- 12.50"`, `"8.79~12.50"`). For a range, returns
 * the upper bound (`Math.max`) so auto-pricing never under-costs a higher-cost
 * variant.
 */
export function parseUsd(v: unknown): number | null {
  if (typeof v === 'number') {
    return Number.isFinite(v) && v >= 0 ? v : null;
  }
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  const direct = Number(trimmed);
  if (Number.isFinite(direct) && direct >= 0) return direct;

  // Match currency-prefixed or range strings such as "8.79 - 12.50" or "8.79 -- 12.50".
  if (/^[\d\s.,$€£¥~–—-]+$/.test(trimmed)) {
    const matches = trimmed.replace(/,/g, '').match(/\d+(?:\.\d+)?/g);
    if (matches && matches.length > 0) {
      const nums = matches.map(Number).filter((n) => Number.isFinite(n) && n >= 0);
      if (nums.length > 0) return Math.max(...nums);
    }
  }
  return null;
}

function firstUsd(o: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = parseUsd(o[k]);
    if (v !== null) return v;
  }
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * Display/log helper: trimmed string capped at 500 chars, or null.
 *
 * WARNING — for display and log fields ONLY. NEVER pass a credential
 * (access token, refresh token, API key) or any other value that is used as
 * data through this helper: the 500-char cap silently corrupted CJ's
 * 593-char access token in production (stored + sent truncated, every
 * authenticated call rejected with 401 / code 1600001). Use
 * credentialString() for credential material.
 */
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s.slice(0, 500) : null;
}

/**
 * Extract credential material EXACTLY as received: no truncation, no
 * rewriting, no trimming. Tokens must survive to the wire byte-for-byte —
 * any cap (like str()'s 500 chars) turns a valid 593-char CJ token into an
 * invalid 500-char one. Returns null for missing/empty values.
 */
function credentialString(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0) return null;
  return v;
}

/**
 * Forensic length guard for freshly issued tokens. CJ issues ~593-char
 * access tokens (CJ support confirmed this length during the 1600001
 * investigation); values at the old 500-char str() cap or outside a sane
 * band are the exact signature of an upstream truncation. Warn only — the
 * token is still used, so a CJ format change degrades gracefully.
 */
function warnIfImplausibleToken(token: string, supplier: string): void {
  if (token.length === 500) {
    logger.warn(
      'CJ access token is exactly 500 chars — classic truncation signature (CJ issues ~593-char tokens). The token will be rejected (1600001); investigate storage limits on this path.',
      { supplier, credentialLength: token.length }
    );
  } else if (token.length < 100 || token.length > 10_000) {
    logger.warn(
      'CJ access token length outside plausible range [100, 10000] — possibly truncated or malformed.',
      { supplier, credentialLength: token.length }
    );
  }
}
