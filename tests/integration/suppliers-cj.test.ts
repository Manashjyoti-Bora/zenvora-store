import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Supplier } from '@prisma/client';
import {
  CJDropshippingAdapter,
  classifyCjFailure,
  extractCjProductPage,
  isUncertainTransportFailure,
  mapCjOrderStatus,
  mapCjTrackingStatus,
  parseUsd,
} from '@/lib/suppliers/cj';
import { logger } from '@/lib/logger';
import { diagnoseSupplierAdapter } from '@/lib/suppliers/registry';
import {
  SupplierRejectedError,
  UnsupportedSupplierOperation,
  type SupplierCreateOrderInput,
} from '@/lib/suppliers/types';

/**
 * CJ Dropshipping adapter tests. The network is fully stubbed: every request
 * the adapter makes is captured so we can assert URLs, headers and bodies
 * against CJ's documented API v2 contract.
 */

process.env.CJ_TEST_API_KEY = 'cj-test-key';

let seq = 0;
function makeSupplier(over: Record<string, unknown> = {}): Supplier {
  seq += 1;
  return {
    id: `sup-cj-${seq}`,
    name: 'CJ Test',
    slug: `cj-test-${seq}`,
    type: 'CJ',
    baseUrl: null,
    apiKeyEnvVar: 'CJ_TEST_API_KEY',
    apiSecretEnvVar: null,
    config: { fxRateInrPerUsd: 88 },
    isActive: true,
    leadTimeDays: 3,
    contactEmail: null,
    contactPhone: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as unknown as Supplier;
}

interface CapturedCall {
  url: string;
  init?: RequestInit;
}

function stubFetch(
  routes: Array<{ match: string; body: unknown }>,
  calls: CapturedCall[]
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const route = routes.find((r) => url.includes(r.match));
      const payload = route?.body ?? { success: false, code: 404, message: `no stub for ${url}` };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
}

const TOKEN_ROUTE = {
  match: 'getAccessToken',
  body: {
    code: 200,
    success: true,
    data: {
      accessToken: 'tok-1',
      accessTokenExpiryDate: new Date(Date.now() + 3_600_000).toISOString(),
      refreshToken: 'rt-1',
    },
  },
};

function orderInput(over: Record<string, unknown> = {}): SupplierCreateOrderInput {
  return {
    internalSupplierOrderId: 'so-row-1',
    idempotencyKey: 'so_so-row-1_sup-cj',
    orderNumber: 'RX-260905-CJ01',
    currency: 'INR',
    items: [{ supplierSku: 'CJW1', name: 'Widget', quantity: 2 }],
    shippingAddress: {
      fullName: 'Asha Buyer',
      phone: '9876543210',
      line1: '1 MG Street',
      line2: null,
      city: 'Guwahati',
      state: 'Assam',
      postalCode: '781001',
      country: 'India',
    },
    customer: { name: 'Asha Buyer', email: 'asha@example.com', phone: '9876543210' },
    paymentMethod: 'PREPAID',
    totalPaise: 12900,
    note: null,
    ...over,
  } as SupplierCreateOrderInput;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CJ adapter construction', () => {
  it('refuses to construct without an explicit FX rate (no hidden conversion)', () => {
    expect(() => new CJDropshippingAdapter(makeSupplier({ config: {} }))).toThrow(
      /fxRateInrPerUsd/
    );
  });

  it('refuses to construct without the API key env var', () => {
    expect(
      () => new CJDropshippingAdapter(makeSupplier({ apiKeyEnvVar: 'CJ_MISSING_KEY_XYZ' }))
    ).toThrow(/apiKeyEnvVar|environment/);
  });

  it('distinguishes a missing record field from a missing environment variable', () => {
    // Cause 1: the supplier record has no env-var NAME at all.
    expect(() => new CJDropshippingAdapter(makeSupplier({ apiKeyEnvVar: null }))).toThrow(
      /apiKeyEnvVar is not set on the supplier record/
    );
    // Cause 2: the record names a variable that this runtime does not have.
    expect(
      () => new CJDropshippingAdapter(makeSupplier({ apiKeyEnvVar: 'CJ_DEFINITELY_MISSING_XYZ' }))
    ).toThrow(/CJ_DEFINITELY_MISSING_XYZ.*valuePresent: false/);
  });

  it('never includes env var values in configuration errors', () => {
    // A secret exists in the environment under one name while the supplier
    // names a MISSING variable: the error must carry only the name and
    // valuePresent:false — never any value picked up from process.env.
    process.env.CJ_LEAK_CANARY = 'super-secret-canary-value';
    try {
      let message = '';
      try {
        new CJDropshippingAdapter(makeSupplier({ apiKeyEnvVar: 'CJ_LEAK_CANARY_ABSENT' }));
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message).toMatch(/CJ_LEAK_CANARY_ABSENT.*valuePresent: false/);
      expect(message).not.toContain('super-secret-canary-value');
    } finally {
      delete process.env.CJ_LEAK_CANARY;
    }
  });

  it('reports honest capabilities (no fake cancellation/returns)', () => {
    const adapter = new CJDropshippingAdapter(makeSupplier());
    expect(adapter.capabilities.orderCreation).toBe(true);
    expect(adapter.capabilities.tracking).toBe(true);
    expect(adapter.capabilities.cancellation).toBe(false);
    expect(adapter.capabilities.returns).toBe(false);
    expect(adapter.capabilities.refunds).toBe(false);
  });
});

describe('CJ catalogue + stock', () => {
  it('exchanges the API key for a token and maps USD costs with the explicit FX rate', async () => {
    const calls: CapturedCall[] = [];
    stubFetch(
      [
        TOKEN_ROUTE,
        {
          match: 'myProduct/query',
          body: {
            success: true,
            data: [
              {
                pid: 'P1',
                productName: 'Wireless Widget',
                sku: 'CJW1',
                buyPrice: 2.5,
                stock: 10,
                variantList: [{ vid: 'V1', sku: 'CJW1', variantBuyPrice: 2.5 }],
              },
            ],
          },
        },
      ],
      calls
    );
    const adapter = new CJDropshippingAdapter(makeSupplier());
    const products = await adapter.getProducts();
    expect(products).toHaveLength(1);
    expect(products[0].sku).toBe('CJW1');
    // 2.5 USD * 88 INR/USD * 100 paise
    expect(products[0].costPaise).toBe(22000);

    const authCall = calls.find((c) => c.url.includes('getAccessToken'));
    expect(authCall).toBeTruthy();
    expect(JSON.parse(String(authCall!.init?.body))).toEqual({ apiKey: 'cj-test-key' });
    const listCall = calls.find((c) => c.url.includes('myProduct/query'));
    expect((listCall!.init!.headers as Record<string, string>)['CJ-Access-Token']).toBe('tok-1');
  });

  it('resolves CJ SKUs to variant ids before stock checks', async () => {
    const calls: CapturedCall[] = [];
    stubFetch(
      [
        TOKEN_ROUTE,
        { match: 'stock/queryBySku', body: { success: true, data: { sku: 'CJW1', vid: 'V1', stock: 7 } } },
        { match: 'stock/queryByVid', body: { success: true, data: { vid: 'V1', stock: 7 } } },
      ],
      calls
    );
    const adapter = new CJDropshippingAdapter(makeSupplier());
    const stock = await adapter.checkStock('CJW1', 5);
    expect(stock.inStock).toBe(true);
    expect(stock.qty).toBe(7);
    expect(calls.some((c) => c.url.includes('queryBySku?sku=CJW1') || c.url.includes('queryBySku?sku=CJW1'.replace('?', '%3F')) || c.url.includes('stock/queryBySku'))).toBe(true);
    expect(calls.some((c) => c.url.includes('stock/queryByVid') && c.url.includes('vid=V1'))).toBe(true);
  });
});

describe('CJ order creation', () => {
  it('sends the documented createOrderV2 payload, then pays from wallet', async () => {
    const calls: CapturedCall[] = [];
    stubFetch(
      [
        TOKEN_ROUTE,
        { match: 'stock/queryBySku', body: { success: true, data: { sku: 'CJW1', vid: 'V1' } } },
        {
          match: 'createOrderV2',
          body: { success: true, data: { orderNumber: 'CJORD1', cjOrderId: 12345 } },
        },
        { match: 'payBalanceV2', body: { success: true, data: true } },
      ],
      calls
    );
    const adapter = new CJDropshippingAdapter(
      makeSupplier({ config: { fxRateInrPerUsd: 88, platformToken: 'pt-9' } })
    );
    const result = await adapter.createOrder(orderInput());
    expect(result.accepted).toBe(true);
    expect(result.supplierOrderId).toBe('CJORD1');
    expect(result.status).toBe('ACCEPTED');

    const createCall = calls.find((c) => c.url.includes('createOrderV2'))!;
    const body = JSON.parse(String(createCall.init?.body)) as Record<string, unknown>;
    expect(body.orderNumber).toBe('RX-260905-CJ01');
    expect(body.shippingCountryCode).toBe('IN');
    expect(body.shippingProvince).toBe('Assam');
    expect(body.orderFlow).toBe(1);
    const products = body.products as Array<Record<string, unknown>>;
    expect(products[0].vid).toBe('V1');
    expect(products[0].quantity).toBe(2);
    expect(String(products[0].storeLineItemId)).toMatch(/^so_so-row-1_sup-cj:/);
    const headers = createCall.init!.headers as Record<string, string>;
    expect(headers['CJ-Access-Token']).toBe('tok-1');
    expect(headers.platformToken).toBe('pt-9');
    expect(calls.some((c) => c.url.includes('payBalanceV2'))).toBe(true);
  });

  it('reports wallet-payment failure honestly instead of claiming fulfilment', async () => {
    const calls: CapturedCall[] = [];
    stubFetch(
      [
        TOKEN_ROUTE,
        { match: 'stock/queryBySku', body: { success: true, data: { sku: 'CJW1', vid: 'V1' } } },
        { match: 'createOrderV2', body: { success: true, data: { orderNumber: 'CJORD2' } } },
        {
          match: 'payBalanceV2',
          body: { success: false, code: 1801001, message: 'insufficient balance' },
        },
      ],
      calls
    );
    const adapter = new CJDropshippingAdapter(makeSupplier());
    const result = await adapter.createOrder(orderInput());
    expect(result.accepted).toBe(true);
    expect(result.status).toBe('PENDING');
    expect(result.message).toMatch(/wallet/i);
    expect(result.supplierOrderId).toBe('CJORD2');
  });

  it('does not duplicate orders on retry: existing-order path continues to payment', async () => {
    const calls: CapturedCall[] = [];
    stubFetch(
      [
        TOKEN_ROUTE,
        { match: 'stock/queryBySku', body: { success: true, data: { sku: 'CJW1', vid: 'V1' } } },
        {
          match: 'createOrderV2',
          body: { success: false, code: 1801002, message: 'order already exists' },
        },
        { match: 'shopping/order/list', body: { success: true, data: [{ orderNumber: 'CJORD3' }] } },
        { match: 'payBalanceV2', body: { success: true, data: true } },
      ],
      calls
    );
    const adapter = new CJDropshippingAdapter(makeSupplier());
    const result = await adapter.createOrder(orderInput());
    expect(result.accepted).toBe(true);
    expect(result.supplierOrderId).toBe('CJORD3');
    expect(calls.filter((c) => c.url.includes('createOrderV2'))).toHaveLength(1);
  });

  it('raises SupplierRejectedError (no pointless retries) when CJ reports out-of-stock', async () => {
    stubFetch(
      [
        TOKEN_ROUTE,
        { match: 'stock/queryBySku', body: { success: true, data: { sku: 'CJW1', vid: 'V1' } } },
        { match: 'createOrderV2', body: { success: false, code: 1801003, message: 'out of stock' } },
      ],
      []
    );
    const adapter = new CJDropshippingAdapter(makeSupplier());
    await expect(adapter.createOrder(orderInput())).rejects.toBeInstanceOf(SupplierRejectedError);
  });
});

describe('CJ status + tracking', () => {
  it('maps order detail statuses', async () => {
    stubFetch(
      [
        TOKEN_ROUTE,
        {
          match: 'getOrderDetail',
          body: {
            success: true,
            data: { orderStatus: 'SHIPPED', trackingNumber: 'TRK1', logisticName: 'CJPacket Ordinary' },
          },
        },
      ],
      []
    );
    const adapter = new CJDropshippingAdapter(makeSupplier());
    const status = await adapter.getOrderStatus('CJORD1');
    expect(status.status).toBe('SHIPPED');
    expect(status.trackingNumber).toBe('TRK1');
  });

  it('maps logistics trackingStatus codes and events', async () => {
    stubFetch(
      [
        TOKEN_ROUTE,
        {
          match: 'trackInfo',
          body: {
            success: true,
            data: {
              trackingNumber: 'TRK1',
              logisticName: 'CJPacket',
              trackingStatus: 12,
              logisticsTrackEvents: [
                { statusDesc: 'Delivered', activity: 'Signed', location: 'Guwahati', eventTime: '2026-09-05 10:00:00' },
              ],
            },
          },
        },
      ],
      []
    );
    const adapter = new CJDropshippingAdapter(makeSupplier());
    const tracking = await adapter.getShipmentTracking('CJORD1');
    expect(tracking.status).toBe('DELIVERED');
    expect(tracking.events).toHaveLength(1);
    expect(tracking.events![0].location).toBe('Guwahati');
  });

  it('status maps cover the documented CJ values', () => {
    expect(mapCjOrderStatus('CREATED')).toBe('ACCEPTED');
    expect(mapCjOrderStatus('PROCESSING')).toBe('PROCESSING');
    expect(mapCjOrderStatus('DELIVERED')).toBe('DELIVERED');
    expect(mapCjOrderStatus('CANCELLED')).toBe('CANCELLED');
    expect(mapCjTrackingStatus(2)).toBe('PROCESSING');
    expect(mapCjTrackingStatus(6)).toBe('SHIPPED');
    expect(mapCjTrackingStatus(10)).toBe('OUT_FOR_DELIVERY');
    expect(mapCjTrackingStatus(12)).toBe('DELIVERED');
    expect(mapCjTrackingStatus(14)).toBe('CANCELLED');
  });
});

describe('CJ unsupported operations are honest', () => {
  it('cancellation/returns/refunds raise UnsupportedSupplierOperation', async () => {
    stubFetch([TOKEN_ROUTE], []);
    const adapter = new CJDropshippingAdapter(makeSupplier());
    await expect(adapter.cancelOrder('CJORD1')).rejects.toBeInstanceOf(
      UnsupportedSupplierOperation
    );
    await expect(adapter.requestReturn('CJORD1', 'damaged')).rejects.toBeInstanceOf(
      UnsupportedSupplierOperation
    );
    await expect(adapter.requestRefund('CJORD1', 100, 'damaged')).rejects.toBeInstanceOf(
      UnsupportedSupplierOperation
    );
  });

  it('registerWebhooks posts the documented webhook/set contract', async () => {
    const calls: CapturedCall[] = [];
    stubFetch([TOKEN_ROUTE, { match: 'webhook/set', body: { success: true, data: true } }], calls);
    const adapter = new CJDropshippingAdapter(makeSupplier());
    const result = await adapter.registerWebhooks('https://store.example/api/suppliers/cj/webhook');
    expect(result.success).toBe(true);
    const body = JSON.parse(String(calls.find((c) => c.url.includes('webhook/set'))!.init?.body));
    expect(body.order.callbackUrls).toEqual(['https://store.example/api/suppliers/cj/webhook']);
    expect(body.logistics.type).toBe('ENABLE');
  });
});

describe('CJ catalogue pagination + failure handling', () => {
  it('follows pagination across full pages and stops on a short page', async () => {
    const calls: CapturedCall[] = [];
    const items = (page: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        pid: `P${page}_${i}`,
        productName: `Item ${page}-${i}`,
        sku: `SKU${page}_${i}`,
        buyPrice: 1,
      }));
    stubFetch(
      [
        TOKEN_ROUTE,
        { match: 'pageNum=1', body: { success: true, data: items(1, 100) } },
        { match: 'pageNum=2', body: { success: true, data: items(2, 30) } },
      ],
      calls
    );
    const adapter = new CJDropshippingAdapter(makeSupplier());
    const products = await adapter.getProducts({ limit: 200 }); // what the sync route uses
    expect(products).toHaveLength(130);
    expect(products[0].sku).toBe('SKU1_0');
    expect(products[99].sku).toBe('SKU1_99');
    expect(products[100].sku).toBe('SKU2_0');
    expect(products[129].sku).toBe('SKU2_29');
    const listCalls = calls.filter((c) => c.url.includes('myProduct/query'));
    expect(listCalls).toHaveLength(2); // short page 2 ends the loop — page 3 never fetched
    expect(listCalls[0].url).toContain('pageNum=1');
    expect(listCalls[1].url).toContain('pageNum=2');
  });

  it('reports non-JSON (HTML/CDN) responses honestly instead of parse errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>503 Service Unavailable</html>', { status: 503 }))
    );
    const adapter = new CJDropshippingAdapter(makeSupplier());
    await expect(adapter.getProducts()).rejects.toThrow(/non-JSON response \(HTTP 503\)/);
  });

  it('surfaces authentication failures with CJ’s own reason', async () => {
    stubFetch([
      {
        match: 'getAccessToken',
        body: { success: false, code: 100001, message: 'Invalid api key' },
      },
    ], []);
    const adapter = new CJDropshippingAdapter(makeSupplier());
    await expect(adapter.getProducts()).rejects.toThrow(
      /CJ authentication failed: Invalid api key/
    );
  });
});

describe('supplier adapter diagnostics (registry)', () => {
  it('reports the precise CJ configuration problem instead of silently falling back', () => {
    const diag = diagnoseSupplierAdapter(
      makeSupplier({ apiKeyEnvVar: 'CJ_DEFINITELY_MISSING_XYZ' })
    );
    expect(diag.ok).toBe(false);
    expect(diag.adapterType).toBe('CJ');
    expect(diag.error).toMatch(/CJ_DEFINITELY_MISSING_XYZ.*valuePresent: false/);
  });

  it('reports configured when the named environment variable exists', () => {
    const diag = diagnoseSupplierAdapter(makeSupplier());
    expect(diag.ok).toBe(true);
    expect(diag.error).toBeNull();
  });

  it('manual suppliers always construct', () => {
    const diag = diagnoseSupplierAdapter({
      ...makeSupplier(),
      type: 'MANUAL',
      apiKeyEnvVar: null,
    } as unknown as Supplier);
    expect(diag.ok).toBe(true);
    expect(diag.adapterType).toBe('MANUAL');
  });
});

/**
 * Stateful stub: each route serves its `bodies` in order and repeats the last
 * one afterwards, counting every call so tests can assert exact attempt
 * counts (retry bounds, exchange counts, logout attempts).
 */
function stubFetchSequence(routes: Array<{ match: string; bodies: unknown[] }>): {
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const counters = new Map<string, number>();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const route = routes.find((r) => url.includes(r.match));
      if (!route) {
        return new Response(
          JSON.stringify({ success: false, code: 404, message: `no stub for ${url}` }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      const index = Math.min(counters.get(route.match) ?? 0, route.bodies.length - 1);
      counters.set(route.match, (counters.get(route.match) ?? 0) + 1);
      return new Response(JSON.stringify(route.bodies[index]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
  return { calls };
}

const tokenBody = (token: string) => ({
  code: 200,
  success: true,
  result: true,
  message: 'Success',
  data: {
    accessToken: token,
    accessTokenExpiryDate: new Date(Date.now() + 3_600_000).toISOString(),
    refreshToken: `rt-${token}`,
  },
});

describe('CJ authentication failure messages are safe and actionable', () => {
  it('explains the 1600300 "email must be not empty" param error without leaking the key', async () => {
    // A real secret sits in the env under the name the supplier references
    // while CJ still reports the empty-key param error: the thrown message
    // must contain the actionable hint but never the value.
    process.env.CJ_HINT_CANARY = 'canary-secret-value';
    try {
      stubFetch(
        [
          {
            match: 'getAccessToken',
            body: { success: false, result: false, code: 1600300, message: 'email must be not empty.' },
          },
        ],
        []
      );
      const adapter = new CJDropshippingAdapter(makeSupplier({ apiKeyEnvVar: 'CJ_HINT_CANARY' }));
      let message = '';
      try {
        await adapter.getProducts();
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message).toMatch(
        /CJ authentication failed: email must be not empty[\s\S]*apiKey value reached CJ empty[\s\S]*code 1600300/
      );
      // The canary value must not appear anywhere in the error.
      expect(message).not.toContain('canary-secret-value');
    } finally {
      delete process.env.CJ_HINT_CANARY;
    }
  });
});

describe('CJ token self-healing (1600001 stale-token recovery)', () => {
  it('logs out, exchanges a fresh token and retries ONCE when CJ rejects the token', async () => {
    const { calls } = stubFetchSequence([
      { match: 'getAccessToken', bodies: [tokenBody('tok-1'), tokenBody('tok-2')] },
      {
        match: 'authentication/logout',
        bodies: [{ code: 200, success: true, result: true, data: true }],
      },
      {
        match: 'myProduct/query',
        bodies: [
          {
            success: false,
            result: false,
            code: 1600001,
            message:
              'Invalid API key or access token. How to get access token: https://developers.cjdropshipping.cn/en/api/api2/api/auth.html',
          },
          {
            success: true,
            result: true,
            code: 200,
            data: [{ pid: 'P1', productName: 'Speaker', sku: 'CJSPK1', buyPrice: 2 }],
          },
        ],
      },
    ]);
    const adapter = new CJDropshippingAdapter(makeSupplier());
    const products = await adapter.getProducts();
    expect(products).toHaveLength(1);
    expect(products[0].sku).toBe('CJSPK1');

    const myProductCalls = calls.filter((c) => c.url.includes('myProduct/query'));
    expect(myProductCalls).toHaveLength(2);
    // The retry carried the NEW token.
    expect((myProductCalls[1].init!.headers as Record<string, string>)['CJ-Access-Token']).toBe(
      'tok-2'
    );
    // Exactly one fresh exchange and one logout, and the logout used the
    // REJECTED token so CJ's 24h server-side cache is broken.
    expect(calls.filter((c) => c.url.includes('getAccessToken'))).toHaveLength(2);
    const logoutCall = calls.find((c) => c.url.includes('authentication/logout'));
    expect(logoutCall).toBeTruthy();
    expect((logoutCall!.init!.headers as Record<string, string>)['CJ-Access-Token']).toBe('tok-1');
  });

  it('retries exactly once, then surfaces the CJ error honestly (no loop, no fake success)', async () => {
    const { calls } = stubFetchSequence([
      { match: 'getAccessToken', bodies: [tokenBody('tok-1'), tokenBody('tok-2')] },
      { match: 'authentication/logout', bodies: [{ success: true, data: true }] },
      {
        match: 'myProduct/query',
        bodies: [
          { success: false, code: 1600001, message: 'Invalid API key or access token.' },
        ],
      },
    ]);
    const adapter = new CJDropshippingAdapter(makeSupplier());
    await expect(adapter.getProducts()).rejects.toThrow(
      /CJ product\/myProduct\/query failed: Invalid API key or access token\. \(code 1600001\)/
    );
    expect(calls.filter((c) => c.url.includes('myProduct/query'))).toHaveLength(2);
    expect(calls.filter((c) => c.url.includes('getAccessToken'))).toHaveLength(2);
    expect(calls.filter((c) => c.url.includes('authentication/logout'))).toHaveLength(1);
  });

  it('does not self-heal business errors (only token-class codes trigger a retry)', async () => {
    const { calls } = stubFetchSequence([
      { match: 'getAccessToken', bodies: [tokenBody('tok-1')] },
      {
        match: 'myProduct/query',
        bodies: [{ success: false, code: 1602001, message: 'Product not found' }],
      },
    ]);
    const adapter = new CJDropshippingAdapter(makeSupplier());
    await expect(adapter.getProducts()).rejects.toThrow(/Product not found/);
    expect(calls.filter((c) => c.url.includes('myProduct/query'))).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes('getAccessToken'))).toHaveLength(1);
    expect(calls.some((c) => c.url.includes('authentication/logout'))).toBe(false);
  });
});

describe('CJ envelope robustness', () => {
  it('accepts documented envelopes that carry result:true without a success field', async () => {
    const calls: CapturedCall[] = [];
    stubFetch(
      [
        {
          match: 'getAccessToken',
          body: {
            code: 200,
            result: true,
            message: 'Success',
            data: {
              accessToken: 'tok-r',
              accessTokenExpiryDate: new Date(Date.now() + 3_600_000).toISOString(),
              refreshToken: 'rt-r',
            },
          },
        },
        { match: 'myProduct/query', body: { code: 200, result: true, message: 'Success', data: [] } },
      ],
      calls
    );
    const adapter = new CJDropshippingAdapter(makeSupplier());
    const products = await adapter.getProducts();
    expect(products).toEqual([]);
  });
});

describe('CJ refresh-token fallback', () => {
  it('refreshes a near-expiry cached token instead of exchanging a new one', async () => {
    const calls: CapturedCall[] = [];
    stubFetch(
      [
        {
          match: 'getAccessToken',
          body: {
            success: true,
            data: {
              accessToken: 'tok-old',
              // 30s left < the 60s cache-safety margin → next call must refresh
              accessTokenExpiryDate: new Date(Date.now() + 30_000).toISOString(),
              refreshToken: 'rt-old',
            },
          },
        },
        {
          match: 'refreshAccessToken',
          body: {
            success: true,
            data: {
              accessToken: 'tok-new',
              accessTokenExpiryDate: new Date(Date.now() + 3_600_000).toISOString(),
              refreshToken: 'rt-new',
            },
          },
        },
        { match: 'myProduct/query', body: { success: true, data: [] } },
      ],
      calls
    );
    const adapter = new CJDropshippingAdapter(makeSupplier());
    await adapter.getProducts(); // first call: fresh exchange
    await adapter.getProducts(); // second call: near-expiry cache → refresh path
    expect(calls.filter((c) => c.url.includes('getAccessToken'))).toHaveLength(1);
    const refreshes = calls.filter((c) => c.url.includes('refreshAccessToken'));
    expect(refreshes).toHaveLength(1);
    expect(JSON.parse(String(refreshes[0].init?.body))).toEqual({ refreshToken: 'rt-old' });
    const listCalls = calls.filter((c) => c.url.includes('myProduct/query'));
    expect((listCalls[1].init!.headers as Record<string, string>)['CJ-Access-Token']).toBe(
      'tok-new'
    );
  });
});

describe('CJ failure classification (official code table)', () => {
  it('maps official CJ codes to safe support-ready classes', () => {
    expect(classifyCjFailure(1600005)).toBe('AUTH_CREDENTIAL_FAILURE');
    expect(classifyCjFailure(1600006)).toBe('AUTH_CREDENTIAL_FAILURE');
    expect(classifyCjFailure(1601000)).toBe('AUTH_CREDENTIAL_FAILURE');
    expect(classifyCjFailure(1600001)).toBe('AUTH_TOKEN_FAILURE');
    expect(classifyCjFailure(1600002)).toBe('AUTH_TOKEN_FAILURE');
    expect(classifyCjFailure(1600003)).toBe('AUTH_TOKEN_FAILURE');
    expect(classifyCjFailure(1600004)).toBe('AUTHORIZATION_FAILURE');
    expect(classifyCjFailure(1600013)).toBe('AUTHORIZATION_FAILURE');
    expect(classifyCjFailure(1600200)).toBe('RATE_LIMIT');
    expect(classifyCjFailure(1600300)).toBe('PARAMETER_FAILURE');
    expect(classifyCjFailure(1600101)).toBe('ENDPOINT_FAILURE');
    expect(classifyCjFailure(1600000)).toBe('CJ_SERVER_FAILURE');
    expect(classifyCjFailure(0)).toBe('NETWORK_FAILURE');
    expect(classifyCjFailure(null)).toBe('NETWORK_FAILURE');
    expect(classifyCjFailure(999999)).toBe('CJ_SERVER_FAILURE');
  });
});

describe('CJ single-flight token recovery (serverless concurrency)', () => {
  it('concurrent rejections share ONE logout + ONE fresh exchange', async () => {
    const calls: CapturedCall[] = [];
    const counters = new Map<string, number>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        const key = url.includes('getAccessToken')
          ? 'auth'
          : url.includes('logout')
            ? 'logout'
            : 'list';
        const n = counters.get(key) ?? 0;
        counters.set(key, n + 1);
        if (key === 'auth') {
          // Slow the exchange so concurrent callers overlap inside the
          // single-flight window (deterministic overlap for the test).
          await new Promise((r) => setTimeout(r, 80));
          return new Response(
            JSON.stringify(tokenBody(n === 0 ? 'tok-1' : 'tok-2')),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (key === 'logout') {
          return new Response(JSON.stringify({ success: true, data: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        // myProduct: first two calls rejected, retries succeed.
        return new Response(
          JSON.stringify(
            n < 2
              ? { success: false, code: 1600001, message: 'Invalid API key or access token.' }
              : {
                  success: true,
                  data: [{ pid: 'P1', productName: 'Speaker', sku: 'CJSPK1', buyPrice: 2 }],
                }
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    const adapter = new CJDropshippingAdapter(makeSupplier());
    const [a, b] = await Promise.all([adapter.getProducts(), adapter.getProducts()]);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    // Without single-flight this would be 2 logouts + 3-4 exchanges, and the
    // second logout would invalidate the first caller's fresh token.
    expect(calls.filter((c) => c.url.includes('authentication/logout'))).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes('getAccessToken'))).toHaveLength(2);
  });
});

describe('CJ token integrity (REGRESSION: 593-char tokens must survive untruncated)', () => {
  /** Deterministic token-like string of exactly n chars (base64url alphabet). */
  function makeToken(n: number, tag: string): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let s = tag;
    let i = 1;
    while (s.length < n) {
      s += alphabet[(i * 7 + (i % 13) + (i % 29)) % alphabet.length];
      i += 1;
    }
    return s.slice(0, n);
  }

  const CJ_REAL_TOKEN_LENGTH = 593; // CJ support-confirmed length of a current access token

  it('stores and sends the FULL 593-char access token byte-for-byte (no 500-char cap)', async () => {
    const full = makeToken(CJ_REAL_TOKEN_LENGTH, 'CJAKia');
    const { calls } = stubFetchSequence([
      { match: 'getAccessToken', bodies: [tokenBody(full)] },
      { match: 'myProduct/query', bodies: [{ success: true, result: true, data: [] }] },
    ]);
    const adapter = new CJDropshippingAdapter(makeSupplier());
    await adapter.getProducts();
    const listCall = calls.find((c) => c.url.includes('myProduct/query'));
    expect(listCall).toBeTruthy();
    const sent = (listCall!.init!.headers as Record<string, string>)['CJ-Access-Token'];
    // Byte-for-byte equality: the old str() cap produced full.slice(0, 500).
    expect(sent).toBe(full);
    expect(sent).toHaveLength(CJ_REAL_TOKEN_LENGTH);
  });

  it('sends a >500-char refresh token untruncated to refreshAccessToken', async () => {
    const longRefresh = makeToken(640, 'CJRRT');
    const next = makeToken(CJ_REAL_TOKEN_LENGTH, 'CJAKib');
    const calls: CapturedCall[] = [];
    stubFetch(
      [
        {
          match: 'getAccessToken',
          body: {
            success: true,
            result: true,
            data: {
              accessToken: 'tok-short',
              // < 60s left → the second call must take the refresh path
              accessTokenExpiryDate: new Date(Date.now() + 10_000).toISOString(),
              refreshToken: longRefresh,
            },
          },
        },
        {
          match: 'refreshAccessToken',
          body: {
            success: true,
            result: true,
            data: {
              accessToken: next,
              accessTokenExpiryDate: new Date(Date.now() + 3_600_000).toISOString(),
              refreshToken: 'rt-next',
            },
          },
        },
        { match: 'myProduct/query', body: { success: true, result: true, data: [] } },
      ],
      calls
    );
    const adapter = new CJDropshippingAdapter(makeSupplier());
    await adapter.getProducts(); // fresh exchange
    await adapter.getProducts(); // near-expiry cache → refresh path
    const refreshCall = calls.find((c) => c.url.includes('refreshAccessToken'));
    expect(refreshCall).toBeTruthy();
    const body = JSON.parse(String(refreshCall!.init?.body)) as Record<string, unknown>;
    expect(body.refreshToken).toBe(longRefresh);
    expect(String(body.refreshToken)).toHaveLength(640);
    const listCalls = calls.filter((c) => c.url.includes('myProduct/query'));
    expect((listCalls[1].init!.headers as Record<string, string>)['CJ-Access-Token']).toBe(next);
    expect((listCalls[1].init!.headers as Record<string, string>)['CJ-Access-Token']).toHaveLength(
      CJ_REAL_TOKEN_LENGTH
    );
  });

  it('probe reports the true received token length and authenticates with the full token', async () => {
    const full = makeToken(CJ_REAL_TOKEN_LENGTH, 'CJAKic');
    const calls: CapturedCall[] = [];
    stubFetch(
      [
        { match: 'getAccessToken', body: tokenBody(full) },
        {
          match: 'setting/get',
          body: { code: 200, success: true, result: true, data: { root: 'GENERAL', isSandbox: false } },
        },
        {
          match: 'myProduct/query',
          body: { code: 200, success: true, result: true, data: { total: 1, list: [{ pid: 'P1', sku: 'CJSPK1' }] } },
        },
      ],
      calls
    );
    const adapter = new CJDropshippingAdapter(makeSupplier());
    const probe = await adapter.probe();
    expect(probe.getAccessToken.tokenLength).toBe(CJ_REAL_TOKEN_LENGTH);
    expect(probe.getAccessToken.tokenPresent).toBe(true);
    expect(probe.classification).toBeNull();
    expect(probe.conclusion).toMatch(/no CJ-side blocker/);
    // The probe's authenticated steps must carry the FULL token: the old
    // str() path made even the diagnostic fail with 1600001.
    const settingCall = calls.find((c) => c.url.includes('setting/get'));
    const queryCall = calls.find((c) => c.url.includes('myProduct/query'));
    expect(settingCall).toBeTruthy();
    expect(queryCall).toBeTruthy();
    expect((settingCall!.init!.headers as Record<string, string>)['CJ-Access-Token']).toBe(full);
    expect((queryCall!.init!.headers as Record<string, string>)['CJ-Access-Token']).toBe(full);
    // Still no secret material in the serialized result.
    expect(JSON.stringify(probe)).not.toContain(full);
  });

  it('logs a truncation-signature warning when a token arrives at exactly 500 chars', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      const truncated = makeToken(500, 'CJAKid');
      stubFetch(
        [
          { match: 'getAccessToken', body: tokenBody(truncated) },
          { match: 'myProduct/query', body: { success: true, result: true, data: [] } },
        ],
        []
      );
      const adapter = new CJDropshippingAdapter(makeSupplier());
      await adapter.getProducts();
      const truncationWarnings = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes('exactly 500 chars')
      );
      expect(truncationWarnings).toHaveLength(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('forensic log fields survive credential-key redaction (lengths are visible, not [REDACTED])', async () => {
    // "received" logs at warn; "sent" logs at info in steady state (warn only
    // when the length carries a truncation signature). Spy on both.
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    try {
      const full = makeToken(CJ_REAL_TOKEN_LENGTH, 'CJAKie');
      stubFetch(
        [
          { match: 'getAccessToken', body: tokenBody(full) },
          { match: 'myProduct/query', body: { success: true, result: true, data: [] } },
        ],
        []
      );
      const adapter = new CJDropshippingAdapter(makeSupplier());
      await adapter.getProducts();
      const allCalls = [...warnSpy.mock.calls, ...infoSpy.mock.calls];
      const received = allCalls.find((c) =>
        String(c[0]).startsWith('CJ forensic token received')
      );
      const sent = allCalls.find((c) =>
        String(c[0]).startsWith('CJ forensic token sent')
      );
      expect(received).toBeTruthy();
      expect(sent).toBeTruthy();
      const receivedCtx = received![1] as Record<string, unknown>;
      const sentCtx = sent![1] as Record<string, unknown>;
      // The logger redacts context keys matching /token/i — the forensic
      // values must be under non-redacted keys or they become [REDACTED].
      expect(receivedCtx.credentialLength).toBe(CJ_REAL_TOKEN_LENGTH);
      expect(sentCtx.credentialLength).toBe(CJ_REAL_TOKEN_LENGTH);
      expect(sentCtx.matchesCache).toBe(true);
      expect(JSON.stringify([receivedCtx, sentCtx])).not.toContain('[REDACTED]');
      // And the message text itself carries the true length (measured on
      // the raw value, pre-processing).
      expect(String(received![0])).toContain(`length=${CJ_REAL_TOKEN_LENGTH}`);
      expect(String(sent![0])).toContain(`length=${CJ_REAL_TOKEN_LENGTH}`);
      // A normal-length token must NOT be flagged suspicious in the message.
      expect(String(sent![0])).not.toContain('SUSPICIOUS');
    } finally {
      warnSpy.mockRestore();
      infoSpy.mockRestore();
    }
  });

  it('escalates the "sent" forensic line to WARN when the token is exactly 500 chars', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    try {
      const truncated = makeToken(500, 'CJAKif');
      stubFetch(
        [
          { match: 'getAccessToken', body: tokenBody(truncated) },
          { match: 'myProduct/query', body: { success: true, result: true, data: [] } },
        ],
        []
      );
      const adapter = new CJDropshippingAdapter(makeSupplier());
      await adapter.getProducts();
      const sent = warnSpy.mock.calls.find((c) =>
        String(c[0]).startsWith('CJ forensic token sent')
      );
      expect(sent).toBeTruthy();
      expect(String(sent![0])).toContain('SUSPICIOUS');
      expect(String(sent![0])).toContain('length=500');
      // …and the same line must NOT also be quietly emitted at info level.
      expect(
        infoSpy.mock.calls.find((c) => String(c[0]).startsWith('CJ forensic token sent'))
      ).toBeUndefined();
    } finally {
      warnSpy.mockRestore();
      infoSpy.mockRestore();
    }
  });

  it('treats success envelopes without a usable accessToken as auth failures (missing, empty, non-string — fail fast, nothing cached or sent)', async () => {
    const expiry = new Date(Date.now() + 3_600_000).toISOString();
    const brokenBodies: Array<{ data: Record<string, unknown>; note: string }> = [
      { data: { accessTokenExpiryDate: expiry }, note: 'missing' },
      { data: { accessToken: '', accessTokenExpiryDate: expiry }, note: 'empty string' },
      { data: { accessToken: 1234567890, accessTokenExpiryDate: expiry }, note: 'non-string' },
    ];
    for (const { data } of brokenBodies) {
      const calls: CapturedCall[] = [];
      stubFetch(
        [
          {
            match: 'getAccessToken',
            body: { code: 200, success: true, result: true, message: 'Success', data },
          },
          { match: 'myProduct/query', body: { success: true, result: true, data: [] } },
        ],
        calls
      );
      const adapter = new CJDropshippingAdapter(makeSupplier());
      // A success envelope with no usable token must fail loudly — never be
      // cached, never trimmed into a partial credential, never retried.
      await expect(adapter.getProducts()).rejects.toThrow(/returned no accessToken/);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toContain('getAccessToken');
      vi.unstubAllGlobals();
    }
  });
});

describe('CJ createOrder uncertain-outcome reconciliation (no duplicate fulfilment)', () => {
  const timeoutEnvelope = {
    success: false,
    code: 0,
    message: 'CJ request timed out after 15000ms',
  };
  const listEmptyBody = { success: true, result: true, data: { total: 0, list: [] } };
  const listFoundBody = {
    success: true,
    result: true,
    data: { total: 1, list: [{ orderNumber: 'CJORD-T', cjOrderId: 777 }] },
  };

  it('classifies transport envelopes (0 and 5xx uncertain; CJ business codes definite)', () => {
    expect(isUncertainTransportFailure({ code: 0 })).toBe(true); // timeout/network/non-JSON
    expect(isUncertainTransportFailure({ code: 503 })).toBe(true); // CDN 5xx
    expect(isUncertainTransportFailure({ code: 500 })).toBe(true);
    expect(isUncertainTransportFailure({ code: 599 })).toBe(true);
    expect(isUncertainTransportFailure({ code: 1600001 })).toBe(false); // CJ auth code
    expect(isUncertainTransportFailure({ code: 1801003 })).toBe(false); // CJ business code
    expect(isUncertainTransportFailure({ code: 400 })).toBe(false); // definite client error
    expect(isUncertainTransportFailure({})).toBe(true); // missing code = unknown envelope
  });

  it('timeout + order EXISTS at CJ → adopts it (ONE createOrderV2 call, no duplicate, wallet pay)', async () => {
    const { calls } = stubFetchSequence([
      { match: 'getAccessToken', bodies: [tokenBody('tok-1')] },
      { match: 'stock/queryBySku', bodies: [{ success: true, data: { sku: 'CJW1', vid: 'V1' } }] },
      { match: 'createOrderV2', bodies: [timeoutEnvelope] },
      { match: 'shopping/order/list', bodies: [listFoundBody] },
      { match: 'payBalanceV2', bodies: [{ success: true, result: true, data: true }] },
    ]);
    const adapter = new CJDropshippingAdapter(makeSupplier());
    const result = await adapter.createOrder(orderInput());
    expect(result.accepted).toBe(true);
    expect(result.supplierOrderId).toBe('CJORD-T');
    expect(result.status).toBe('ACCEPTED');
    // The reconciliation path must NOT re-create: exactly one createOrderV2.
    expect(calls.filter((c) => c.url.includes('createOrderV2'))).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes('shopping/order/list'))).toHaveLength(1);
    const payCall = calls.find((c) => c.url.includes('payBalanceV2'));
    expect(payCall).toBeTruthy();
    expect(JSON.parse(String(payCall!.init?.body))).toEqual({ orderNumber: 'CJORD-T' });
  });

  it('timeout + reconciliation proves the order does NOT exist → transient error (safe retry)', async () => {
    const { calls } = stubFetchSequence([
      { match: 'getAccessToken', bodies: [tokenBody('tok-1')] },
      { match: 'stock/queryBySku', bodies: [{ success: true, data: { sku: 'CJW1', vid: 'V1' } }] },
      { match: 'createOrderV2', bodies: [timeoutEnvelope] },
      { match: 'shopping/order/list', bodies: [listEmptyBody] },
      { match: 'payBalanceV2', bodies: [{ success: true, data: true }] },
    ]);
    const adapter = new CJDropshippingAdapter(makeSupplier());
    await expect(adapter.createOrder(orderInput())).rejects.toThrow(/reconciliation confirmed no order exists — retry is safe/);
    // Not settled: no wallet payment was attempted.
    expect(calls.some((c) => c.url.includes('payBalanceV2'))).toBe(false);
    expect(calls.filter((c) => c.url.includes('createOrderV2'))).toHaveLength(1);
  });

  it('timeout + reconciliation UNREACHABLE → UNCERTAIN result with admin instructions (no silent retry, no silent failure)', async () => {
    stubFetch(
      [
        { match: 'getAccessToken', body: tokenBody('tok-1') },
        { match: 'stock/queryBySku', body: { success: true, data: { sku: 'CJW1', vid: 'V1' } } },
        { match: 'createOrderV2', body: timeoutEnvelope },
        // The lookup itself times out: CJ unreachable → outcome unknown.
        { match: 'shopping/order/list', body: { success: false, code: 0, message: 'CJ request timed out after 15000ms' } },
      ],
      []
    );
    const adapter = new CJDropshippingAdapter(makeSupplier());
    const result = await adapter.createOrder(orderInput());
    expect(result.accepted).toBe(false);
    expect(result.failureClass).toBe('UNCERTAIN');
    expect(result.message).toMatch(/UNKNOWN whether order RX-260905-CJ01 exists at CJ/);
    expect(result.message).toMatch(/CJ dashboard/);
    expect(result.message).toMatch(/Retry/);
  });

  it('HTTP 5xx (non-JSON CDN error) is treated as uncertain and reconciled, not as a business rejection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const json = (payload: unknown, status = 200) =>
          new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
        if (url.includes('createOrderV2')) {
          return new Response('<html>503 Service Unavailable</html>', { status: 503 });
        }
        if (url.includes('shopping/order/list')) {
          return json({ success: true, result: true, data: { total: 0, list: [] } });
        }
        if (url.includes('stock/queryBySku')) {
          return json({ success: true, data: { sku: 'CJW1', vid: 'V1' } });
        }
        return json(tokenBody('tok-1'));
      })
    );
    const adapter = new CJDropshippingAdapter(makeSupplier());
    // 503 + empty authoritative list → transient, safe to retry.
    await expect(adapter.createOrder(orderInput())).rejects.toThrow(
      /retry is safe/
    );
  });

  it('explicit CJ business rejection → BUSINESS_REJECTION, and no reconciliation/resubmission is attempted', async () => {
    const { calls } = stubFetchSequence([
      { match: 'getAccessToken', bodies: [tokenBody('tok-1')] },
      { match: 'stock/queryBySku', bodies: [{ success: true, data: { sku: 'CJW1', vid: 'V1' } }] },
      {
        match: 'createOrderV2',
        bodies: [{ success: false, result: false, code: 1802001, message: 'Invalid shipping address' }],
      },
      { match: 'shopping/order/list', bodies: [listEmptyBody] },
    ]);
    const adapter = new CJDropshippingAdapter(makeSupplier());
    const result = await adapter.createOrder(orderInput());
    expect(result.accepted).toBe(false);
    expect(result.failureClass).toBe('BUSINESS_REJECTION');
    expect(result.message).toMatch(/Invalid shipping address/);
    // A business rejection is definite: the lookup (and therefore any
    // resubmission path) must not be touched.
    expect(calls.some((c) => c.url.includes('shopping/order/list'))).toBe(false);
    expect(calls.filter((c) => c.url.includes('createOrderV2'))).toHaveLength(1);
  });

  it('“already exists” with an EMPTY authoritative lookup parks as UNCERTAIN (does not guess)', async () => {
    const { calls } = stubFetchSequence([
      { match: 'getAccessToken', bodies: [tokenBody('tok-1')] },
      { match: 'stock/queryBySku', bodies: [{ success: true, data: { sku: 'CJW1', vid: 'V1' } }] },
      {
        match: 'createOrderV2',
        bodies: [{ success: false, result: false, code: 1801002, message: 'order already exists' }],
      },
      { match: 'shopping/order/list', bodies: [listEmptyBody] },
    ]);
    const adapter = new CJDropshippingAdapter(makeSupplier());
    const result = await adapter.createOrder(orderInput());
    expect(result.accepted).toBe(false);
    expect(result.failureClass).toBe('UNCERTAIN');
    expect(result.message).toMatch(/no rows/);
    expect(calls.some((c) => c.url.includes('payBalanceV2'))).toBe(false);
  });
});

describe('CJ authorization failures are not retried', () => {
  it('1600004 surfaces once, classified, with no logout/self-heal', async () => {
    const { calls } = stubFetchSequence([
      { match: 'getAccessToken', bodies: [tokenBody('tok-1')] },
      {
        match: 'myProduct/query',
        bodies: [
          { success: false, code: 1600004, message: 'Authorization failed, Please check cj account' },
        ],
      },
    ]);
    const adapter = new CJDropshippingAdapter(makeSupplier());
    await expect(adapter.getProducts()).rejects.toThrow(
      /\(code 1600004\) \[AUTHORIZATION_FAILURE\]/
    );
    expect(calls.filter((c) => c.url.includes('myProduct/query'))).toHaveLength(1);
    expect(calls.some((c) => c.url.includes('authentication/logout'))).toBe(false);
  });
});

describe('CJ forensic probe (safe; no secret material)', () => {
  it('reports structured diagnostics without ever exposing key or token values', async () => {
    stubFetch(
      [
        {
          match: 'getAccessToken',
          body: {
            code: 200,
            success: true,
            result: true,
            data: {
              accessToken: 'tok-probe-secret-value',
              accessTokenExpiryDate: new Date(Date.now() + 3_600_000).toISOString(),
              refreshToken: 'rt-probe',
            },
          },
        },
        {
          match: 'setting/get',
          body: { code: 200, success: true, result: true, data: { root: 'GENERAL', isSandbox: false } },
        },
        {
          match: 'myProduct/query',
          body: {
            code: 200,
            success: true,
            result: true,
            data: { total: 3, list: [{ pid: 'P1', sku: 'CJSPK1' }] },
          },
        },
      ],
      []
    );
    const adapter = new CJDropshippingAdapter(makeSupplier());
    const probe = await adapter.probe();
    expect(probe.apiKeyPresent).toBe(true);
    expect(probe.apiKeyLength).toBeGreaterThan(0);
    expect(probe.apiKeyFingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(probe.getAccessToken.ok).toBe(true);
    expect(probe.getAccessToken.tokenPresent).toBe(true);
    expect(probe.getAccessToken.tokenFingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(probe.getAccessToken.tokenExpiryPresent).toBe(true);
    expect(probe.authenticatedProbe.ok).toBe(true);
    expect(probe.authenticatedProbe.root).toBe('GENERAL');
    expect(probe.myProductQuery.ok).toBe(true);
    expect(probe.myProductQuery.returned).toBe(1);
    expect(probe.myProductQuery.total).toBe(3);
    expect(probe.classification).toBeNull();
    expect(probe.conclusion).toMatch(/no CJ-side blocker/);
    // Secret-material canary: neither the token nor the API key value may
    // appear anywhere in the serialized probe result.
    const json = JSON.stringify(probe);
    expect(json).not.toContain('tok-probe-secret-value');
    expect(json).not.toContain('cj-test-key');
    expect(json).not.toContain('rt-probe');
  });

  it('reads CJ’s own authorization verdict and concludes CJ-side when it denies access', async () => {
    stubFetch(
      [
        {
          match: 'getAccessToken',
          body: {
            code: 200,
            success: true,
            data: {
              accessToken: 'tok-auth-ok',
              accessTokenExpiryDate: new Date(Date.now() + 3_600_000).toISOString(),
              refreshToken: 'rt-ok',
            },
          },
        },
        {
          match: 'setting/get',
          body: { code: 200, success: true, data: { root: 'NO_PERMISSION', isSandbox: false } },
        },
        {
          match: 'myProduct/query',
          body: { success: false, code: 1600001, message: 'Invalid API key or access token.' },
        },
      ],
      []
    );
    const adapter = new CJDropshippingAdapter(makeSupplier());
    const probe = await adapter.probe();
    // Exchange + authenticated setting/get succeed…
    expect(probe.getAccessToken.ok).toBe(true);
    expect(probe.authenticatedProbe.ok).toBe(true);
    expect(probe.authenticatedProbe.root).toBe('NO_PERMISSION');
    // …but the catalog endpoint still rejects the freshly issued token.
    expect(probe.myProductQuery.code).toBe(1600001);
    expect(probe.classification).toBe('AUTH_TOKEN_FAILURE');
    expect(probe.conclusion).toMatch(/NOT fully authorized|CJ's side/);
    expect(JSON.stringify(probe)).not.toContain('tok-auth-ok');
  });
});

describe('CJ My Products envelope + mapping regression (data.content / totalRecords / price ranges)', () => {
  it('maps the documented CJ product/myProduct/query Spring Page envelope (data.content + totalRecords + productId + nameEn + sellPrice/freightTrial)', async () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    try {
      const calls: CapturedCall[] = [];
      stubFetch(
        [
          TOKEN_ROUTE,
          {
            match: 'myProduct/query',
            body: {
              code: 200,
              result: true,
              success: true,
              message: 'Success',
              requestId: 'req-myprod-2',
              data: {
                pageSize: 100,
                pageNumber: 1,
                totalRecords: 2,
                totalPages: 1,
                content: [
                  {
                    productId: '04182450-4636-4F18-996E-9B0B43E91234',
                    nameEn: 'Portable USB Blender',
                    sku: 'CJBL-001',
                    bigImage: 'https://cf.cjdropshipping.com/img1.jpg',
                    sellPrice: '8.50',
                    freightTrial: '3.50',
                    totalPrice: '12.00',
                    areaId: '1',
                    areaEn: 'China Warehouse',
                    shopMethod: 'CJPacket Ordinary',
                  },
                  {
                    productId: '98123450-4636-4F18-996E-9B0B43E95678',
                    nameEn: 'Foldable LED Desk Lamp',
                    sku: 'CJDL-002',
                    bigImage: 'https://cf.cjdropshipping.com/img2.jpg',
                    // Multi-variant price range string returned by CJ My Products
                    sellPrice: '10.00 - 12.50',
                    freightTrial: '4.00',
                    totalPrice: '14.00 - 16.50',
                  },
                ],
              },
            },
          },
        ],
        calls
      );

      const adapter = new CJDropshippingAdapter(makeSupplier());
      const products = await adapter.getProducts({ limit: 200 });

      expect(products).toHaveLength(2);
      expect(products[0]).toMatchObject({
        externalId: '04182450-4636-4F18-996E-9B0B43E91234',
        sku: 'CJBL-001',
        name: 'Portable USB Blender',
        // 8.50 USD * 88 INR/USD * 100 paise = 74800
        costPaise: 74800,
        // 3.50 USD * 88 INR/USD * 100 paise = 30800
        shippingPaise: 30800,
      });
      expect(products[1]).toMatchObject({
        externalId: '98123450-4636-4F18-996E-9B0B43E95678',
        sku: 'CJDL-002',
        name: 'Foldable LED Desk Lamp',
        // Upper bound of "10.00 - 12.50" = 12.50 USD * 88 * 100 = 110000
        costPaise: 110000,
        // 4.00 USD * 88 * 100 = 35200
        shippingPaise: 35200,
      });

      // Only one page request needed when totalRecords=2, totalPages=1
      expect(calls.filter((c) => c.url.includes('myProduct/query'))).toHaveLength(1);

      // Safe structural log check: logs structure & counts, never token or key
      const pageLog = infoSpy.mock.calls.find(
        (c) => String(c[0]) === 'CJ myProduct/query page received'
      );
      expect(pageLog).toBeTruthy();
      const ctx = pageLog![1] as Record<string, unknown>;
      expect(ctx.listKey).toBe('content');
      expect(ctx.totalReported).toBe(2);
      expect(ctx.itemCount).toBe(2);
      expect(ctx.dataKeys).toEqual([
        'pageSize',
        'pageNumber',
        'totalRecords',
        'totalPages',
        'content',
      ]);
      expect(JSON.stringify(ctx)).not.toContain('tok-1');
      expect(JSON.stringify(ctx)).not.toContain('cj-test-key');
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('deduplicates repeated SKUs or productIds across pages and handles server-capped pageSize via totalPages/totalRecords', async () => {
    const calls: CapturedCall[] = [];
    stubFetch(
      [
        TOKEN_ROUTE,
        {
          match: 'pageNum=1',
          body: {
            code: 200,
            result: true,
            data: {
              pageSize: 2,
              pageNumber: 1,
              totalRecords: 3,
              totalPages: 2,
              content: [
                { productId: 'PID-1', nameEn: 'Item One', sku: 'CJSKU-1', sellPrice: '5.00' },
                { productId: 'PID-2', nameEn: 'Item Two', sku: 'CJSKU-2', sellPrice: '6.00' },
              ],
            },
          },
        },
        {
          match: 'pageNum=2',
          body: {
            code: 200,
            result: true,
            data: {
              pageSize: 2,
              pageNumber: 2,
              totalRecords: 3,
              totalPages: 2,
              content: [
                // Duplicate of page 1 item + one new item
                { productId: 'PID-2', nameEn: 'Item Two Duplicate', sku: 'CJSKU-2', sellPrice: '6.00' },
                { productId: 'PID-3', nameEn: 'Item Three', sku: 'CJSKU-3', sellPrice: '7.00' },
              ],
            },
          },
        },
      ],
      calls
    );

    const adapter = new CJDropshippingAdapter(makeSupplier());
    const products = await adapter.getProducts({ limit: 200 });
    expect(products).toHaveLength(3);
    expect(products.map((p) => p.sku)).toEqual(['CJSKU-1', 'CJSKU-2', 'CJSKU-3']);
    expect(calls.filter((c) => c.url.includes('myProduct/query'))).toHaveLength(2);
  });

  it('handles empty My Products (content: [], totalRecords: 0) without inventing products and reports 0 in probe conclusion', async () => {
    const calls: CapturedCall[] = [];
    stubFetch(
      [
        TOKEN_ROUTE,
        {
          match: 'setting/get',
          body: { code: 200, result: true, data: { root: 'GENERAL', isSandbox: false } },
        },
        {
          match: 'myProduct/query',
          body: {
            code: 200,
            result: true,
            data: {
              pageSize: 100,
              pageNumber: 1,
              totalRecords: 0,
              totalPages: 0,
              content: [],
            },
          },
        },
      ],
      calls
    );

    const adapter = new CJDropshippingAdapter(makeSupplier());
    const products = await adapter.getProducts({ limit: 200 });
    expect(products).toEqual([]);
    expect(calls.filter((c) => c.url.includes('myProduct/query'))).toHaveLength(1);

    const probe = await adapter.probe();
    expect(probe.myProductQuery.ok).toBe(true);
    expect(probe.myProductQuery.total).toBe(0);
    expect(probe.myProductQuery.returned).toBe(0);
    expect(probe.myProductQuery.listKey).toBe('content');
    expect(probe.conclusion).toMatch(/returned 0 products/);
  });

  it('surfaces classified API errors from product/myProduct/query (never silently returns empty list)', async () => {
    stubFetch(
      [
        TOKEN_ROUTE,
        {
          match: 'myProduct/query',
          body: {
            code: 1600200,
            result: false,
            success: false,
            message: 'Call frequency too fast, please try again later',
          },
        },
      ],
      []
    );
    const adapter = new CJDropshippingAdapter(makeSupplier());
    await expect(adapter.getProducts()).rejects.toThrow(
      /CJ product\/myProduct\/query failed:.*\(code 1600200\) \[RATE_LIMIT\]/
    );
  });

  it('unit-tests parseUsd and extractCjProductPage across CJ formats', () => {
    expect(parseUsd(8.79)).toBe(8.79);
    expect(parseUsd('8.79')).toBe(8.79);
    expect(parseUsd('$8.79')).toBe(8.79);
    expect(parseUsd('8.79 - 12.50')).toBe(12.5);
    expect(parseUsd('8.79 -- 12.50')).toBe(12.5);
    expect(parseUsd('8.79~12.50')).toBe(12.5);
    expect(parseUsd('')).toBeNull();
    expect(parseUsd(null)).toBeNull();

    const springPage = extractCjProductPage({
      pageSize: 10,
      pageNumber: 1,
      totalRecords: 2,
      totalPages: 1,
      content: [{ productId: 'P1', nameEn: 'A', sku: 'S1' }],
    });
    expect(springPage.listKey).toBe('content');
    expect(springPage.total).toBe(2);
    expect(springPage.items).toHaveLength(1);
  });
});

