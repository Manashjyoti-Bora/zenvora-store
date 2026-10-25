import { describe, expect, it } from 'vitest';
import { buildAiCeoReport } from '@/lib/ai-ceo/engine';
import { makeEmptyStoreSnapshot, makeOrder, makeSnapshot } from './ai-ceo-fixtures';

describe('AI CEO — deterministic report engine', () => {
  it('produces byte-identical output for the same snapshot (pure)', () => {
    const snapshot = makeSnapshot();
    expect(JSON.stringify(buildAiCeoReport(snapshot))).toBe(JSON.stringify(buildAiCeoReport(snapshot)));
  });

  it('reports a configured, trading store without inventing problems', () => {
    const report = buildAiCeoReport(makeSnapshot());
    expect(report.overallLevel).toBe('OK');
    expect(report.risks).toHaveLength(0);
    expect(report.sales.paidOrderCount).toBe(1);
    expect(report.sales.basis).toBe('DERIVED');
    expect(report.headline).toMatch(/1 realised order/i);
    expect(report.provider.status).toBe('DISABLED');
    expect(report.provider.narrativeAvailable).toBe(false);
    expect(report.modes.authorisedBusinessOperations).toBe(false);
  });

  it('turns an unconfigured store into launch blockers with owner actions', () => {
    const report = buildAiCeoReport(makeEmptyStoreSnapshot());
    const blockerIds = report.readiness
      .filter((i) => i.blocks.includes('LAUNCH') && i.status !== 'PASS')
      .map((i) => i.id);

    expect(blockerIds).toContain('payments-configured');
    expect(blockerIds).toContain('support-email');
    expect(blockerIds).toContain('business-identity');
    expect(report.risks.some((r) => r.id === 'risk-payments')).toBe(true);
    expect(report.overallLevel).toBe('CRITICAL');

    const paymentRec = report.recommendations.find((r) => r.id === 'rec-payments');
    expect(paymentRec?.proposedAction.requiresApproval).toBe(true);
    expect(paymentRec?.proposedAction.executable).toBe(false);
    expect(paymentRec?.proposedAction.mode).toBe('MODE_3_APPROVAL');
    expect(paymentRec?.priority).toBe(1);
  });

  it('marks legal/tax items as needing professional advice instead of asserting compliance', () => {
    const report = buildAiCeoReport(makeEmptyStoreSnapshot());
    const identity = report.readiness.find((i) => i.id === 'business-identity');
    expect(identity?.needsProfessionalAdvice).toBe(true);
    const policies = report.readiness.find((i) => i.id === 'policies');
    expect(policies?.needsProfessionalAdvice).toBe(true);
    const text = JSON.stringify(report).toLowerCase();
    expect(text).not.toContain('lawfully compliant');
    expect(text).not.toContain('gst compliant');
    expect(text).not.toContain('100% ready');
  });

  it('every recommendation carries objective, evidence, uncertainty and a verification method', () => {
    const reports = [
      buildAiCeoReport(makeEmptyStoreSnapshot()),
      buildAiCeoReport(makeSnapshot()),
      buildAiCeoReport(
        makeSnapshot({
          jobs: {
            counts: { PENDING: 9, FAILED: 2 },
            failedLast24h: 2,
            oldestPendingAt: '2026-10-23T10:00:00.000Z',
            oldestPendingType: 'SEND_NOTIFICATION',
          },
          refunds: { requested: 1, processing: 1, completed: 0, failed: 2 },
          suppliers: {
            ...makeSnapshot().suppliers,
            syncBySupplier: { sup_1: { at: '2026-10-01T00:00:00.000Z', status: 'PARTIAL_FAILURE', failed: 4, total: 40 } },
          },
          catalog: { productCounts: { ACTIVE: 2, DRAFT: 5 }, activeWithoutSupplierLink: 1, activeWithoutImage: 1 },
        })
      ),
    ];

    for (const report of reports) {
      for (const rec of report.recommendations) {
        expect(rec.objective.length).toBeGreaterThan(5);
        expect(rec.issue.length).toBeGreaterThan(5);
        expect(rec.evidence.length).toBeGreaterThan(0);
        for (const item of rec.evidence) expect(item.source.length).toBeGreaterThan(0);
        expect(rec.confidence.basis.length).toBeGreaterThan(5);
        expect(rec.verification.length).toBeGreaterThan(5);
        expect(rec.priority).toBeGreaterThanOrEqual(1);
        expect(rec.priority).toBeLessThanOrEqual(5);
        // Executable implies low-risk; approval and executability are exclusive.
        if (rec.proposedAction.executable) {
          expect(rec.proposedAction.mode).toBe('MODE_2_EXECUTE');
          expect(rec.proposedAction.requiresApproval).toBe(false);
        }
        // Every recommendation is sorted by priority within the report.
        expect(rec.id).toMatch(/^rec-/);
      }
      const priorities = report.recommendations.map((r) => r.priority);
      expect([...priorities].sort((a, b) => a - b)).toEqual(priorities);
    }
  });

  it('never emits a numeric confidence score', () => {
    const report = buildAiCeoReport(makeEmptyStoreSnapshot());
    for (const rec of report.recommendations) {
      expect(Object.keys(rec.confidence).sort()).toEqual(['basis', 'level']);
      expect(rec.confidence.level).toMatch(/^(HIGH|MEDIUM|LOW)$/);
    }
  });

  it('states that profitability is not measurable when no cost is booked', () => {
    const report = buildAiCeoReport(
      makeSnapshot({
        orders: {
          window: [
            makeOrder({
              supplierCostTotalPaise: 0,
              shippingCostTotalPaise: 0,
              paymentFeeTotalPaise: 0,
              otherCostTotalPaise: 0,
            }),
          ],
          countsByStatus: { DELIVERED: 1 },
          pendingPaymentOlderThan24h: 0,
          windowCount: 1,
        },
      })
    );
    expect(report.sales.contributionPaise).toBeNull();
    expect(report.dataGaps.join(' ')).toMatch(/contribution is an upper bound/i);
    expect(report.recommendations.some((r) => r.id === 'rec-cost-data')).toBe(true);
  });

  it('refuses to infer demand from zero sales', () => {
    const report = buildAiCeoReport(
      makeSnapshot({
        orders: { window: [], countsByStatus: {}, pendingPaymentOlderThan24h: 0, windowCount: 0 },
      })
    );
    const rec = report.recommendations.find((r) => r.id === 'rec-no-sales-evidence');
    expect(rec).toBeDefined();
    expect(rec?.proposedAction.mode).toBe('MODE_0_OBSERVE');
    expect(rec?.proposedAction.executable).toBe(false);
    expect(report.dataGaps.join(' ')).toMatch(/not measurable/i);
  });

  it('keeps the action modes off by default and reflects the kill switch', () => {
    const off = buildAiCeoReport(makeSnapshot());
    expect(off.modes.approvedLowRiskExecution).toBe(false);

    const on = buildAiCeoReport(
      makeSnapshot({
        automation: { ...makeSnapshot().automation, aiCeoEnabled: true, aiCeoActionsEnabled: true },
      })
    );
    expect(on.modes.approvedLowRiskExecution).toBe(true);
    expect(on.modes.authorisedBusinessOperations).toBe(false);

    const killed = buildAiCeoReport(
      makeSnapshot({
        automation: { ...makeSnapshot().automation, aiCeoEnabled: false, aiCeoActionsEnabled: true },
      })
    );
    expect(killed.modes.approvedLowRiskExecution).toBe(false);
  });

  it('surfaces stale supplier data as a launch-blocking oversell risk', () => {
    const report = buildAiCeoReport(
      makeSnapshot({
        suppliers: {
          total: 1,
          inactive: 0,
          syncBySupplier: {},
          rows: [
            {
              id: 'sp_old',
              supplierId: 'sup_1',
              supplierName: 'CJ',
              supplierActive: true,
              supplierCostPaise: 20_000,
              supplierShippingPaise: 2_000,
              inStock: true,
              stockQty: 3,
              lastSyncedAt: '2026-10-01T00:00:00.000Z',
              linkedProductStatus: 'ACTIVE',
            },
          ],
        },
      })
    );
    expect(report.risks.some((r) => r.id === 'risk-oversell' && r.blocksLaunch)).toBe(true);
  });

  it('passes the shared Health/Operations readiness list through verbatim', () => {
    const shared = {
      blockers: ['Razorpay credentials not configured'],
      configGaps: ['Business details missing: principal address'],
    };
    const report = buildAiCeoReport(makeSnapshot({ sharedReadiness: shared }));
    expect(report.readinessShared.blockers).toEqual(shared.blockers);
    expect(report.readinessShared.configGaps).toEqual(shared.configGaps);
    expect(report.readinessShared.source).toMatch(/collectLaunchReadiness/);
  });

  it('caps the recommendation list without dropping the highest priorities', () => {
    const report = buildAiCeoReport(makeEmptyStoreSnapshot(), { maxRecommendations: 3 });
    expect(report.recommendations.length).toBeLessThanOrEqual(3);
    expect(report.recommendations.every((r) => r.priority <= 2)).toBe(true);
  });
});
