import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { publishSupplierProduct } from '@/lib/catalog/publish';
import { ApiError } from '@/lib/errors';
import { cleanupTestData, createTestSupplier, createTestUser, unique } from './fixtures';

/**
 * Supplier-product publication: a synced supplier entry becomes a real catalog
 * product through the same validated write path as the admin form.
 *
 * The guarantees under test:
 *  - nothing is published without a real supplier cost (no ₹0.00 products),
 *  - the default is DRAFT, and ACTIVE requires human-authored copy,
 *  - an already-mapped entry is never touched (protects a live price),
 *  - the pricing engine sets the price and the mapping is linked + audited.
 */
describe('publishSupplierProduct', () => {
  let supplierId: string;
  let actor: { id: string; email: string };

  async function createSupplierEntry(
    over: Partial<{ supplierCost: string; isActive: boolean; raw: object | null }> = {}
  ) {
    return prisma.supplierProduct.create({
      data: {
        supplierId,
        supplierSku: unique('CJ-PUB').toUpperCase(),
        supplierCost: over.supplierCost ?? '300.00',
        supplierShippingCost: '40.00',
        inStock: true,
        stockQty: 15,
        isActive: over.isActive ?? true,
        lastSyncedAt: new Date(),
        raw: (over.raw ?? { productName: 'CJ Wireless Earbuds Pro' }) as object,
      },
    });
  }

  beforeAll(async () => {
    await cleanupTestData();
    const supplier = await createTestSupplier();
    supplierId = supplier.id;
    // A real admin row: audit logging references the actor by foreign key, so a
    // synthetic id would be silently dropped from the audit trail.
    const admin = await createTestUser({ role: 'ADMIN', name: 'Publish Admin' });
    actor = { id: admin.id, email: admin.email };
    // A global pricing rule so publication works without an explicit markup
    // (mirrors a configured store).
    await prisma.pricingRule.create({
      data: {
        name: `Itest global markup ${unique('rule')}`,
        scope: 'GLOBAL',
        mode: 'PERCENT_MARKUP',
        percentMarkup: '35',
        roundingRule: 'ROUND_UP_10',
        isActive: true,
        priority: 1000,
      },
    });
  });

  afterAll(async () => {
    await prisma.pricingRule.deleteMany({ where: { name: { startsWith: 'Itest global markup' } } });
    await cleanupTestData();
  });

  it('creates a DRAFT product, links the mapping and prices it through the engine', async () => {
    const entry = await createSupplierEntry();
    const result = await publishSupplierProduct({
      supplierProductId: entry.id,
      actor,
      percentMarkup: 35,
    });

    expect(result.status).toBe('DRAFT');
    expect(result.sellingPricePaise).toBeGreaterThan(0);

    const product = await prisma.product.findUnique({ where: { id: result.productId } });
    expect(product).not.toBeNull();
    expect(product!.status).toBe('DRAFT');
    expect(product!.supplierId).toBe(supplierId);
    expect(product!.supplierSku).toBe(entry.supplierSku);
    expect(product!.stockMode).toBe('SUPPLIER_SYNC');
    expect(Number(product!.supplierCost)).toBe(300);
    expect(Number(product!.sellingPrice)).toBeCloseTo(result.sellingPricePaise / 100, 2);

    const linked = await prisma.supplierProduct.findUnique({ where: { id: entry.id } });
    expect(linked!.productId).toBe(result.productId);
  });

  it('never invents marketing copy — the description says it is unreviewed', async () => {
    const entry = await createSupplierEntry({ raw: null });
    const result = await publishSupplierProduct({ supplierProductId: entry.id, actor });
    const product = await prisma.product.findUnique({ where: { id: result.productId } });
    expect(product!.description.toLowerCase()).toContain('not been reviewed');
    expect(result.warnings.join(' ')).toMatch(/draft/i);
  });

  it('refuses an entry with no usable cost (would publish a ₹0.00 product)', async () => {
    const entry = await createSupplierEntry({ supplierCost: '0.00' });
    await expect(
      publishSupplierProduct({ supplierProductId: entry.id, actor })
    ).rejects.toThrow(/no usable cost/i);
    const stillUnmapped = await prisma.supplierProduct.findUnique({ where: { id: entry.id } });
    expect(stillUnmapped!.productId).toBeNull();
  });

  it('refuses an inactive (de-synced) entry', async () => {
    const entry = await createSupplierEntry({ isActive: false });
    await expect(
      publishSupplierProduct({ supplierProductId: entry.id, actor })
    ).rejects.toThrow(/inactive/i);
  });

  it('requires human-authored copy before publishing straight to ACTIVE', async () => {
    const entry = await createSupplierEntry();
    await expect(
      publishSupplierProduct({ supplierProductId: entry.id, actor, status: 'ACTIVE' })
    ).rejects.toThrow(/description/i);

    const ok = await createSupplierEntry();
    const published = await publishSupplierProduct({
      supplierProductId: ok.id,
      actor,
      status: 'ACTIVE',
      name: 'Reviewed Wireless Earbuds',
      description: 'Reviewed description written by a human, long enough to pass validation.',
      percentMarkup: 35,
    });
    expect(published.status).toBe('ACTIVE');
    const product = await prisma.product.findUnique({ where: { id: published.productId } });
    expect(product!.status).toBe('ACTIVE');
    expect(product!.name).toBe('Reviewed Wireless Earbuds');
  });

  it('refuses to publish over an entry that is already mapped', async () => {
    const entry = await createSupplierEntry();
    const first = await publishSupplierProduct({ supplierProductId: entry.id, actor });
    await expect(
      publishSupplierProduct({ supplierProductId: entry.id, actor })
    ).rejects.toThrow(/already mapped/i);
    // The first product is untouched.
    const product = await prisma.product.findUnique({ where: { id: first.productId } });
    expect(product).not.toBeNull();
  });

  it('records the publication in the audit trail', async () => {
    const entry = await createSupplierEntry();
    const result = await publishSupplierProduct({ supplierProductId: entry.id, actor });
    const log = await prisma.auditLog.findFirst({
      where: { action: 'supplier_product.published', entityId: result.productId },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log!.actorEmail).toBe(actor.email);
  });

  it('rejects an unknown supplier entry', async () => {
    await expect(
      publishSupplierProduct({ supplierProductId: 'does-not-exist', actor })
    ).rejects.toThrow(ApiError);
  });
});
