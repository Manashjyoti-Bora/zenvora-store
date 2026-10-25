import { describe, expect, it } from 'vitest';
import { computeSalesReport } from '@/lib/ai-ceo/metrics';
import { makeOrder } from './ai-ceo-fixtures';

describe('AI CEO — verified commerce metrics', () => {
  it('nets refunds out of revenue and subtracts only recorded costs', () => {
    const rows = [
      makeOrder({ id: 'a', grandTotalPaise: 100_000 }),
      makeOrder({
        id: 'b',
        grandTotalPaise: 50_000,
        refundedTotalPaise: 20_000,
        supplierCostTotalPaise: 30_000,
        shippingCostTotalPaise: 2_000,
        paymentFeeTotalPaise: 1_000,
      }),
    ];

    const report = computeSalesReport(rows, 30);
    expect(report.paidOrderCount).toBe(2);
    expect(report.grossPaidRevenuePaise).toBe(150_000);
    expect(report.refundedPaise).toBe(20_000);
    expect(report.netRevenuePaise).toBe(130_000);
    expect(report.supplierCostPaise).toBe(90_000);
    expect(report.contributionPaise).toBe(130_000 - (90_000 + 7_000 + 3_000));
    expect(report.basis).toBe('DERIVED');
    expect(report.contributionMarginPercent).toBeCloseTo(
      Math.round(((130_000 - 100_000) / 130_000) * 10_000) / 100,
      5
    );
  });

  it('refuses to invent a margin when no cost is booked, and says why', () => {
    const report = computeSalesReport(
      [
        makeOrder({
          supplierCostTotalPaise: 0,
          shippingCostTotalPaise: 0,
          paymentFeeTotalPaise: 0,
          otherCostTotalPaise: 0,
        }),
      ],
      30
    );

    expect(report.netRevenuePaise).toBe(100_000);
    expect(report.contributionPaise).toBeNull();
    expect(report.contributionMarginPercent).toBeNull();
    expect(report.basis).toBe('UNKNOWN');
    expect(report.caveats.some((c) => /profitability is unknown/i.test(c))).toBe(true);

    const contribution = report.metrics.find((m) => m.key === 'contribution');
    expect(contribution?.valuePaise).toBeNull();
    expect(contribution?.basis).toBe('UNKNOWN');
  });

  it('marks partial cost coverage as an estimate (an upper bound)', () => {
    const report = computeSalesReport(
      [
        makeOrder({ id: 'with-costs', grandTotalPaise: 100_000 }),
        makeOrder({
          id: 'no-costs',
          grandTotalPaise: 100_000,
          supplierCostTotalPaise: 0,
          shippingCostTotalPaise: 0,
          paymentFeeTotalPaise: 0,
          otherCostTotalPaise: 0,
        }),
      ],
      30
    );

    expect(report.costCoverage).toBeCloseTo(0.5, 5);
    expect(report.basis).toBe('ESTIMATE');
    expect(report.caveats.some((c) => /upper bound/i.test(c))).toBe(true);
  });

  it('excludes committed-but-uncollected COD orders from revenue', () => {
    const report = computeSalesReport(
      [
        makeOrder({ id: 'prepaid' }),
        makeOrder({
          id: 'cod',
          paymentMethod: 'COD',
          paymentStatus: 'COD_PENDING',
          placedAt: '2026-10-24T10:00:00.000Z',
          paidAt: null,
          grandTotalPaise: 80_000,
        }),
      ],
      30
    );

    expect(report.paidOrderCount).toBe(1);
    expect(report.committedCodOrderCount).toBe(1);
    expect(report.grossPaidRevenuePaise).toBe(100_000);
    expect(report.caveats.some((c) => /cash-on-delivery/i.test(c))).toBe(true);
  });

  it('counts cancelled orders separately without counting their money', () => {
    const report = computeSalesReport(
      [
        makeOrder({ id: 'ok' }),
        makeOrder({
          id: 'cancelled',
          status: 'CANCELLED',
          paymentStatus: 'FAILED',
          cancelledAt: '2026-10-21T10:00:00.000Z',
        }),
      ],
      30
    );
    expect(report.cancelledOrderCount).toBe(1);
    expect(report.grossPaidRevenuePaise).toBe(100_000);
  });

  it('reports zero revenue honestly for an empty window', () => {
    const report = computeSalesReport([], 30);
    expect(report.paidOrderCount).toBe(0);
    expect(report.netRevenuePaise).toBe(0);
    expect(report.contributionPaise).toBeNull();
    expect(report.averageOrderValuePaise).toBeNull();
    expect(report.basis).toBe('UNKNOWN');
    expect(report.caveats.join(' ')).toMatch(/no realised/i);
  });

  it('flags a sample size too small to establish a trend', () => {
    const report = computeSalesReport([makeOrder(), makeOrder({ id: 'b' })], 30);
    expect(report.caveats.some((c) => /does not establish a trend/i.test(c))).toBe(true);
  });

  it('never labels revenue as profit', () => {
    const report = computeSalesReport([makeOrder()], 30);
    for (const metric of report.metrics) {
      expect(metric.label.toLowerCase()).not.toContain('profit');
      expect(metric.label.toLowerCase()).not.toContain('net profit');
    }
    const contribution = report.metrics.find((m) => m.key === 'contribution');
    expect(contribution?.label).toMatch(/before overheads/i);
  });

  it('carries the truncation warning when the row cap was hit', () => {
    const report = computeSalesReport([makeOrder()], 30, true);
    expect(report.caveats.some((c) => /row cap|floor/i.test(c))).toBe(true);
  });
});
