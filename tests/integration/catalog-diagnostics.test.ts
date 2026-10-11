import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { getCatalogPipelineCounts } from '@/lib/catalog/diagnostics';
import { cleanupTestData, createTestProduct, createTestSupplier, unique } from './fixtures';

describe('catalog pipeline diagnostics', () => {
  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it('counts exact published eligibility, drafts, stored supplier entries, and review states', async () => {
    const before = await getCatalogPipelineCounts();
    const supplier = await createTestSupplier();
    const activeProduct = await createTestProduct({
      name: 'Itest Diagnostics Published',
      sellingPrice: '250.00',
    });
    const draftProduct = await createTestProduct({
      name: 'Itest Diagnostics Draft',
      sellingPrice: '350.00',
    });
    const unpricedProduct = await createTestProduct({
      name: 'Itest Diagnostics Unpriced',
      sellingPrice: '0.00',
    });
    await prisma.product.update({ where: { id: draftProduct.id }, data: { status: 'DRAFT' } });

    await prisma.supplierProduct.create({
      data: {
        supplierId: supplier.id,
        productId: activeProduct.id,
        supplierSku: unique('CJ-DIAG-PUBLISHED').toUpperCase(),
        supplierCost: '125.00',
        isActive: true,
        raw: { importState: { status: 'PUBLISHED', reasons: [] } },
      },
    });
    await prisma.supplierProduct.create({
      data: {
        supplierId: supplier.id,
        supplierSku: unique('CJ-DIAG-REVIEW').toUpperCase(),
        supplierCost: '100.00',
        isActive: false,
        raw: { importState: { status: 'NEEDS_REVIEW', reasons: ['Needs review'] } },
      },
    });
    await prisma.supplierProduct.create({
      data: {
        supplierId: supplier.id,
        supplierSku: unique('CJ-DIAG-REJECTED').toUpperCase(),
        supplierCost: '0.00',
        isActive: true,
        raw: { importState: { status: 'REJECTED', reasons: ['Missing cost'] } },
      },
    });

    const after = await getCatalogPipelineCounts();

    expect(after.products.total - before.products.total).toBe(3);
    expect(after.products.active - before.products.active).toBe(2);
    expect(after.products.storefrontEligible - before.products.storefrontEligible).toBe(1);
    expect(after.products.activeUnpriced - before.products.activeUnpriced).toBe(1);
    expect(after.products.draft - before.products.draft).toBe(1);
    expect(after.supplierProducts.total - before.supplierProducts.total).toBe(3);
    expect(after.supplierProducts.mapped - before.supplierProducts.mapped).toBe(1);
    expect(after.supplierProducts.unmapped - before.supplierProducts.unmapped).toBe(2);
    expect(after.supplierProducts.needsReview - before.supplierProducts.needsReview).toBe(1);
    expect(after.supplierProducts.rejected - before.supplierProducts.rejected).toBe(1);
    expect(after.supplierProducts.importPublished - before.supplierProducts.importPublished).toBe(
      1
    );
    expect(after.supplierProducts.importDraft - before.supplierProducts.importDraft).toBe(0);
    expect(after.supplierProducts.importUnmapped - before.supplierProducts.importUnmapped).toBe(0);
    expect(after.supplierProducts.active - before.supplierProducts.active).toBe(2);
    expect(after.supplierProducts.inactive - before.supplierProducts.inactive).toBe(1);

    expect(unpricedProduct.status).toBe('ACTIVE');
  });
});
