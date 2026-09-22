import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Supplier } from '@prisma/client';
import {
  CJDropshippingAdapter,
  mapCjOrderStatus,
  mapCjTrackingStatus,
} from '@/lib/suppliers/cj';
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
