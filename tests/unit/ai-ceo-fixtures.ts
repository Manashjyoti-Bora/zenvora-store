import type { AiCeoSnapshot, OrderLedgerRow } from '@/lib/ai-ceo/contracts';

/**
 * Fixtures for the AI CEO intelligence layer. These build the SAME snapshot
 * contract the database adapter produces, so the tests exercise the real
 * reasoning code without a database.
 */

const AS_OF = '2026-10-25T10:00:00.000Z';

export function makeOrder(overrides: Partial<OrderLedgerRow> = {}): OrderLedgerRow {
  return {
    id: overrides.id ?? 'ord_1',
    status: 'DELIVERED',
    paymentStatus: 'PAID',
    paymentMethod: 'PREPAID_GATEWAY',
    placedAt: '2026-10-20T10:00:00.000Z',
    paidAt: '2026-10-20T10:01:00.000Z',
    deliveredAt: '2026-10-24T10:00:00.000Z',
    cancelledAt: null,
    grandTotalPaise: 100_000,
    subtotalPaise: 95_100,
    discountTotalPaise: 0,
    shippingTotalPaise: 4_900,
    taxTotalPaise: 0,
    supplierCostTotalPaise: 60_000,
    shippingCostTotalPaise: 5_000,
    paymentFeeTotalPaise: 2_000,
    otherCostTotalPaise: 0,
    refundedTotalPaise: 0,
    estimatedProfitPaise: 33_000,
    actualProfitPaise: 0,
    profitFinalizedAt: null,
    ...overrides,
  };
}

/** A store that is configured, trading and clean on every measured surface. */
export function makeSnapshot(overrides: Partial<AiCeoSnapshot> = {}): AiCeoSnapshot {
  const base: AiCeoSnapshot = {
    asOf: AS_OF,
    windowDays: 30,
    truncated: false,
    store: {
      name: 'Zenvora',
      demoMode: false,
      supportEmailConfigured: true,
      supportPhoneConfigured: true,
      businessIdentity: 'COMPLETE',
    },
    payments: { kind: 'RAZORPAY', isTest: false, environment: 'production' },
    automation: {
      autoPublishEligible: false,
      supplierLiveOrderingEnabled: false,
      cronSecretConfigured: true,
      aiProviderConfigured: false,
      aiCeoEnabled: true,
      aiCeoActionsEnabled: false,
    },
    orders: {
      window: [makeOrder()],
      countsByStatus: { DELIVERED: 1 },
      pendingPaymentOlderThan24h: 0,
      windowCount: 1,
    },
    refunds: { requested: 0, processing: 0, completed: 0, failed: 0 },
    returns: { open: 0 },
    supportMessages: { open: 0 },
    jobs: {
      counts: { PENDING: 0, RUNNING: 0, FAILED: 0 },
      failedLast24h: 0,
      oldestPendingAt: null,
      oldestPendingType: null,
    },
    webhooks: { last24hByStatus: { PROCESSED: 3 } },
    errors: { last24h: 0, fatalLast24h: 0 },
    suppliers: {
      total: 1,
      inactive: 0,
      rows: [
        {
          id: 'sp_1',
          supplierId: 'sup_1',
          supplierName: 'CJ Dropshipping',
          supplierActive: true,
          supplierCostPaise: 50_000,
          supplierShippingPaise: 5_000,
          inStock: true,
          stockQty: 25,
          lastSyncedAt: '2026-10-25T06:00:00.000Z',
          linkedProductStatus: 'ACTIVE',
        },
      ],
      syncBySupplier: {
        sup_1: { at: '2026-10-25T06:00:00.000Z', status: 'COMPLETED', failed: 0, total: 40 },
      },
    },
    catalog: {
      productCounts: { ACTIVE: 3, DRAFT: 1, ARCHIVED: 0 },
      activeWithoutSupplierLink: 0,
      activeWithoutImage: 0,
    },
    audit: { lastAction: 'settings.updated', lastAt: '2026-10-25T09:00:00.000Z' },
  };

  return {
    ...base,
    ...overrides,
    store: { ...base.store, ...(overrides.store ?? {}) },
    payments: { ...base.payments, ...(overrides.payments ?? {}) },
    automation: { ...base.automation, ...(overrides.automation ?? {}) },
    orders: { ...base.orders, ...(overrides.orders ?? {}) },
    refunds: { ...base.refunds, ...(overrides.refunds ?? {}) },
    returns: { ...base.returns, ...(overrides.returns ?? {}) },
    supportMessages: { ...base.supportMessages, ...(overrides.supportMessages ?? {}) },
    jobs: { ...base.jobs, ...(overrides.jobs ?? {}) },
    webhooks: { ...base.webhooks, ...(overrides.webhooks ?? {}) },
    errors: { ...base.errors, ...(overrides.errors ?? {}) },
    suppliers: { ...base.suppliers, ...(overrides.suppliers ?? {}) },
    catalog: { ...base.catalog, ...(overrides.catalog ?? {}) },
    audit: { ...base.audit, ...(overrides.audit ?? {}) },
  };
}

/** A brand-new deployment: nothing configured, nothing sold. */
export function makeEmptyStoreSnapshot(): AiCeoSnapshot {
  return makeSnapshot({
    store: {
      name: 'Zenvora',
      demoMode: true,
      supportEmailConfigured: false,
      supportPhoneConfigured: false,
      businessIdentity: 'MISSING',
    },
    payments: { kind: 'NONE', isTest: false, environment: 'production' },
    automation: {
      autoPublishEligible: false,
      supplierLiveOrderingEnabled: false,
      cronSecretConfigured: false,
      aiProviderConfigured: false,
      aiCeoEnabled: true,
      aiCeoActionsEnabled: false,
    },
    orders: { window: [], countsByStatus: {}, pendingPaymentOlderThan24h: 0, windowCount: 0 },
    webhooks: { last24hByStatus: {} },
    suppliers: { total: 0, inactive: 0, rows: [], syncBySupplier: {} },
    catalog: { productCounts: {}, activeWithoutSupplierLink: 0, activeWithoutImage: 0 },
    audit: { lastAction: null, lastAt: null },
  });
}

export { AS_OF };
