import { describe, expect, it } from 'vitest';
import {
  ageHours,
  errorHealth,
  jobQueueHealth,
  orderPipelineHealth,
  paymentPostureHealth,
  webhookHealth,
  worstLevel,
} from '@/lib/ai-ceo/operations';
import { computeCatalogReport, computeSupplierReport, catalogHealth } from '@/lib/ai-ceo/catalog';
import { AS_OF, makeOrder, makeSnapshot } from './ai-ceo-fixtures';

describe('AI CEO — health evaluation', () => {
  it('ranks levels so a critical surface dominates', () => {
    expect(worstLevel(['OK', 'WATCH'])).toBe('WATCH');
    expect(worstLevel(['WATCH', 'ACTION'])).toBe('ACTION');
    expect(worstLevel(['ACTION', 'CRITICAL'])).toBe('CRITICAL');
    expect(worstLevel([])).toBe('OK');
    expect(worstLevel(['UNKNOWN', 'OK'])).toBe('UNKNOWN');
  });

  it('computes ages from the snapshot time, never wall-clock time', () => {
    expect(ageHours('2026-10-25T08:00:00.000Z', AS_OF)).toBe(2);
    expect(ageHours(null, AS_OF)).toBeNull();
    expect(ageHours('not-a-date', AS_OF)).toBeNull();
  });

  it('flags a queue whose oldest job is past the runner threshold', () => {
    const snapshot = makeSnapshot({
      jobs: {
        counts: { PENDING: 4, RUNNING: 0, FAILED: 1 },
        failedLast24h: 2,
        oldestPendingAt: '2026-10-24T06:00:00.000Z',
        oldestPendingType: 'FULFIL_SUPPLIER_ORDER',
      },
    });
    const health = jobQueueHealth(snapshot);
    expect(health.level).toBe('ACTION');
    expect(health.summary).toMatch(/runner is not draining/i);
  });

  it('keeps an idle queue healthy', () => {
    const health = jobQueueHealth(makeSnapshot());
    expect(health.level).toBe('OK');
  });

  it('treats failed payment webhooks as actionable', () => {
    const health = webhookHealth(makeSnapshot({ webhooks: { last24hByStatus: { FAILED: 2, PROCESSED: 5 } } }));
    expect(health.level).toBe('ACTION');
    expect(health.summary).toMatch(/failed processing/i);
  });

  it('treats rejected webhook signatures as something to watch', () => {
    const health = webhookHealth(makeSnapshot({ webhooks: { last24hByStatus: { REJECTED: 1 } } }));
    expect(health.level).toBe('WATCH');
  });

  it('escalates fatal errors to critical and quiet logs to OK', () => {
    expect(errorHealth(makeSnapshot()).level).toBe('OK');
    expect(errorHealth(makeSnapshot({ errors: { last24h: 1, fatalLast24h: 0 } })).level).toBe('WATCH');
    expect(errorHealth(makeSnapshot({ errors: { last24h: 12, fatalLast24h: 0 } })).level).toBe('ACTION');
    expect(errorHealth(makeSnapshot({ errors: { last24h: 2, fatalLast24h: 1 } })).level).toBe('CRITICAL');
  });

  it('detects paid orders stuck in fulfilment inside the window', () => {
    const snapshot = makeSnapshot({
      orders: {
        window: [
          makeOrder({
            status: 'PROCESSING',
            paidAt: '2026-10-10T10:00:00.000Z', // 15 days before asOf
            placedAt: '2026-10-10T10:00:00.000Z',
          }),
        ],
        countsByStatus: { PROCESSING: 1 },
        pendingPaymentOlderThan24h: 0,
        windowCount: 1,
      },
    });
    const health = orderPipelineHealth(snapshot);
    expect(health.level).toBe('ACTION');
    expect(health.summary).toMatch(/still open after 7 days/i);
  });

  it('reports payments honestly when nothing is configured', () => {
    expect(paymentPostureHealth(makeSnapshot({ payments: { kind: 'NONE', isTest: false, environment: 'production' } })).level).toBe('CRITICAL');
    expect(paymentPostureHealth(makeSnapshot({ payments: { kind: 'TEST', isTest: true, environment: 'development' } })).level).toBe('ACTION');
    expect(paymentPostureHealth(makeSnapshot()).level).toBe('OK');
  });
});

describe('AI CEO — catalogue & supplier analysis', () => {
  it('counts stock evidence without treating unknown as available', () => {
    const snapshot = makeSnapshot({
      suppliers: {
        total: 1,
        inactive: 0,
        syncBySupplier: {},
        rows: [
          {
            id: 'sp_in',
            supplierId: 'sup_1',
            supplierName: 'CJ',
            supplierActive: true,
            supplierCostPaise: 10_000,
            supplierShippingPaise: 1_000,
            inStock: true,
            stockQty: 5,
            lastSyncedAt: '2026-10-25T09:00:00.000Z',
            linkedProductStatus: 'ACTIVE',
          },
          {
            id: 'sp_out',
            supplierId: 'sup_1',
            supplierName: 'CJ',
            supplierActive: true,
            supplierCostPaise: 10_000,
            supplierShippingPaise: null,
            inStock: false,
            stockQty: 0,
            lastSyncedAt: '2026-10-20T09:00:00.000Z',
            linkedProductStatus: null,
          },
          {
            id: 'sp_unknown',
            supplierId: 'sup_1',
            supplierName: 'CJ',
            supplierActive: true,
            supplierCostPaise: 0,
            supplierShippingPaise: null,
            inStock: null,
            stockQty: null,
            lastSyncedAt: null,
            linkedProductStatus: 'DRAFT',
          },
        ],
      },
    });

    const report = computeCatalogReport(snapshot, 48);
    expect(report.inStock).toBe(1);
    expect(report.outOfStock).toBe(1);
    expect(report.unknownStock).toBe(1);
    expect(report.stale).toBe(1); // sp_out synced 5 days ago
    expect(report.neverSynced).toBe(1);
    expect(report.missingShippingCost).toBe(2);
    expect(report.missingCost).toBe(1);
    expect(report.linkedActive).toBe(1);
    expect(report.linkedDraft).toBe(1);
    expect(report.unlinked).toBe(1);
    expect(catalogHealth(snapshot, report).level).not.toBe('OK');
  });

  it('treats an empty catalogue as an action item', () => {
    const snapshot = makeSnapshot({ catalog: { productCounts: {}, activeWithoutSupplierLink: 0, activeWithoutImage: 0 } });
    const report = computeCatalogReport(snapshot, 48);
    expect(catalogHealth(snapshot, report).summary).toMatch(/nothing to sell/i);
  });

  it('surfaces supplier sync failures and stale suppliers', () => {
    const snapshot = makeSnapshot({
      suppliers: {
        total: 2,
        inactive: 1,
        rows: [],
        syncBySupplier: {
          sup_1: { at: '2026-10-01T06:00:00.000Z', status: 'PARTIAL_FAILURE', failed: 3, total: 50 },
          sup_2: { at: null, status: 'FAILED', failed: 1, total: 1 },
        },
      },
    });
    const report = computeSupplierReport(snapshot);
    expect(report.failingSyncs).toHaveLength(2);
    expect(report.staleSuppliers).toHaveLength(2);
    expect(report.inactive).toBe(1);
  });
});
