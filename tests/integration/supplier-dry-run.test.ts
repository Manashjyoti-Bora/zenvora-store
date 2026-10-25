import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { syncAndAutoProcessSupplier } from '@/lib/catalog/auto-import';
import { buildSupplierDryRunReport } from '@/lib/catalog/dry-run';
import { unique } from './fixtures';

/**
 * The supplier dry run must use the real evaluator over real discovered rows
 * and must not write anything: no products, no categories, no importState,
 * no audit rows, no settings.
 */
describe('supplier pipeline dry run', () => {
  let supplierId: string;

  beforeAll(async () => {
    const id = unique('itest-dryrun');
    const sup = await prisma.supplier.create({
      data: { name: `Itest DryRun ${id}`, slug: id, type: 'DEMO', isActive: true, leadTimeDays: 2 },
    });
    supplierId = sup.id;
    // Discover only (no import) — the demo adapter yields a mixed-quality catalogue.
    const report = await syncAndAutoProcessSupplier({
      supplierId,
      limit: 50,
      autoImport: false,
      autoPublishEligible: false,
      actor: { id: null, email: 'admin@itest.local' },
    });
    expect(report.status).toBe('COMPLETED');
    expect(report.totals.discovered).toBeGreaterThanOrEqual(8);
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { supplierId } });
    await prisma.supplierProduct.deleteMany({ where: { supplierId } });
    await prisma.setting.deleteMany({
      where: {
        OR: [{ key: `supplier_sync_report:${supplierId}` }, { key: `supplier_sync_checkpoint:${supplierId}` }],
      },
    });
    await prisma.supplier.delete({ where: { id: supplierId } });
  });

  async function snapshot() {
    const [products, categories, audits, settings, rows] = await Promise.all([
      prisma.product.count(),
      prisma.category.count(),
      prisma.auditLog.count(),
      prisma.setting.count(),
      prisma.supplierProduct.findMany({
        where: { supplierId },
        select: { id: true, updatedAt: true, raw: true, productId: true },
        orderBy: { id: 'asc' },
      }),
    ]);
    return { products, categories, audits, settings, rows: JSON.stringify(rows) };
  }

  it('reports decisions, lifecycle, demand confidence and contribution margin for every row — and writes nothing', async () => {
    const before = await snapshot();

    const report = await buildSupplierDryRunReport({ supplierId, mode: 'IMPORT_ELIGIBLE_DRAFT', limit: 100 });

    const after = await snapshot();
    expect(after).toEqual(before);
    expect(report.writes).toBe(0);

    expect(report.examined).toBeGreaterThanOrEqual(8);
    expect(report.truncated).toBe(false);
    expect(
      report.wouldPublish + report.wouldImportDraft + report.wouldHold + report.wouldReject + report.wouldSkip
    ).toBe(report.examined);
    // Nothing is published in a draft-mode dry run, and auto-publish is off by default.
    expect(report.wouldPublish).toBe(0);
    expect(report.thresholds.autoPublishEnabled).toBe(false);

    // The demo catalogue intentionally contains at least one rejectable and one review item.
    expect(report.wouldReject + report.wouldHold).toBeGreaterThan(0);
    expect(report.wouldImportDraft).toBeGreaterThan(0);
    expect(report.topReasons.length).toBeGreaterThan(0);

    // Lifecycle: nothing is imported yet, so no ACTIVE/APPROVED; counts sum to examined.
    const lifecycleTotal = Object.values(report.lifecycleCounts).reduce((a, b) => a + b, 0);
    expect(lifecycleTotal).toBe(report.examined);
    expect(report.lifecycleCounts.ACTIVE).toBe(0);
    expect(report.lifecycleCounts.APPROVED).toBe(0);

    // Demand confidence is reported honestly (no fabricated popularity).
    const demandTotal = Object.values(report.demandCounts).reduce((a, b) => a + b, 0);
    expect(demandTotal).toBe(report.examined);

    for (const item of report.items) {
      expect(item.lifecycle.state).toBeTruthy();
      expect(item.lifecycle.reason.length).toBeGreaterThan(5);
      expect(item.contribution.lines.length).toBe(8);
      // Every line is labelled with how we know it.
      for (const line of item.contribution.lines) {
        expect(['SUPPLIER_QUOTE', 'CONFIGURED', 'ESTIMATE', 'REALIZED', 'UNKNOWN']).toContain(line.basis);
      }
      if (item.wouldDo === 'REJECT') expect(item.rejectionReasons.length).toBeGreaterThan(0);
      if (item.wouldDo === 'HOLD_FOR_REVIEW') expect(item.reviewReasons.length).toBeGreaterThan(0);
      if (item.wouldDo === 'IMPORT_AS_DRAFT') {
        expect(item.rejectionReasons).toEqual([]);
        expect(item.sellingPricePaise).toBeGreaterThan(0);
      }
    }
    expect(report.economics.priceableItems).toBeGreaterThan(0);
    expect(report.economics.medianContributionPercent).not.toBeNull();
  });

  it('SAFE_PUBLISH mode still publishes nothing while autoPublishEligible is false', async () => {
    const report = await buildSupplierDryRunReport({ supplierId, mode: 'SAFE_PUBLISH_ELIGIBLE', limit: 100 });
    expect(report.wouldPublish).toBe(0);
    expect(report.thresholds.autoPublishEnabled).toBe(false);
  });

  it('respects the limit and flags truncation', async () => {
    const report = await buildSupplierDryRunReport({ supplierId, limit: 3 });
    expect(report.examined).toBe(3);
    expect(report.truncated).toBe(true);
  });
});
