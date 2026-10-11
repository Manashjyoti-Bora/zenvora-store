import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import {
  addToWishlist,
  removeFromWishlist,
  getWishlistView,
  attachGuestWishlistToUser,
  WISHLIST_COOKIE,
} from '@/lib/wishlist/service';
import { saveProduct } from '@/lib/catalog/products';
import {
  syncAndAutoProcessSupplier,
  bulkProcessSupplierProducts,
  getSupplierSyncReport,
} from '@/lib/catalog/auto-import';
import { getFulfilmentReadinessReport } from '@/lib/catalog/fulfilment-readiness';
import { clearCookieJar } from './mock-headers';
import { cleanupTestData, createTestProduct, createTestUser, unique } from './fixtures';

describe('wishlist service (guest + user persistence, atomic merge, unpublished handling)', () => {
  let prodAId: string;
  let prodBId: string;
  let userId: string;

  beforeAll(async () => {
    await cleanupTestData();
    const a = await createTestProduct({
      name: 'Itest Wishlist Item A',
      stock: 10,
      sellingPrice: '499.00',
    });
    const b = await createTestProduct({
      name: 'Itest Wishlist Item B',
      stock: 8,
      sellingPrice: '799.00',
    });
    prodAId = a.id;
    prodBId = b.id;
    const user = await createTestUser();
    userId = user.id;
  });

  beforeEach(() => {
    clearCookieJar();
  });

  afterAll(async () => {
    await prisma.setting.deleteMany({
      where: {
        OR: [
          { key: { startsWith: 'wishlist:user:' } },
          { key: { startsWith: 'wishlist:guest:' } },
        ],
      },
    });
    await cleanupTestData();
  });

  it('persists guest wishlist items, merges them atomically into user wishlist on login, and handles unpublished products gracefully', async () => {
    // 1. Guest adds Item A to wishlist
    const guestView = await addToWishlist({ userId: null, productId: prodAId });
    expect(guestView.count).toBe(1);
    expect(guestView.productIds).toEqual([prodAId]);
    expect(guestView.items[0]?.available).toBe(true);
    expect(guestView.items[0]?.product?.pricePaise).toBe(49900);

    const jar = (globalThis as unknown as { __cookieJar: Map<string, { value: string }> })
      .__cookieJar;
    expect(jar.has(WISHLIST_COOKIE)).toBe(true);

    // 2. Signed-in user already has Item B in their wishlist
    const savedCookie = jar.get(WISHLIST_COOKIE);
    clearCookieJar();
    await addToWishlist({ userId, productId: prodBId });

    // Restore guest cookie and simulate login merge
    if (savedCookie) jar.set(WISHLIST_COOKIE, savedCookie);
    await attachGuestWishlistToUser(userId);
    expect(jar.has(WISHLIST_COOKIE)).toBe(false);

    // 3. Merged user wishlist contains both Item B and Item A without duplicates
    const mergedView = await getWishlistView(userId);
    expect(mergedView.count).toBe(2);
    expect(mergedView.productIds).toEqual([prodBId, prodAId]);

    // 4. Unpublish Item A (set status to DRAFT) -> wishlist view must NOT crash,
    //    must mark Item A as unavailable while preserving its snapshot name,
    //    and allow removing it cleanly.
    await prisma.product.update({
      where: { id: prodAId },
      data: { status: 'DRAFT' },
    });

    const afterUnpublish = await getWishlistView(userId);
    expect(afterUnpublish.count).toBe(2);
    const itemA = afterUnpublish.items.find((i) => i.productId === prodAId)!;
    expect(itemA.available).toBe(false);
    expect(itemA.product).toBeNull();
    expect(itemA.unavailableName).toBe('Itest Wishlist Item A');
    expect(itemA.unavailableReason).toMatch(/no longer available/i);

    const afterRemove = await removeFromWishlist({ userId, productId: prodAId });
    expect(afterRemove.count).toBe(1);
    expect(afterRemove.productIds).toEqual([prodBId]);
  });
});

describe('automatic variant-level pricing in saveProduct', () => {
  it('computes distinct variant selling prices from variant supplierCost when no manual sellingPrice override is set', async () => {
    const slug = `itest-var-pricing-${unique('slug')}`;
    const saved = await saveProduct(
      {
        name: `Itest Variant Pricing ${unique('name')}`,
        slug,
        description: 'Product with multi-cost variants priced automatically by the pricing engine.',
        status: 'DRAFT',
        stockMode: 'SUPPLIER_SYNC',
        supplierCost: 40000, // ₹400
        supplierShippingCost: 5000, // ₹50
        otherCost: 0,
        pricingMode: 'PERCENT_MARKUP',
        percentMarkup: 50,
        fixedPrice: null,
        fixedMargin: null,
        minProfit: null,
        roundingRule: 'NONE',
        compareAtPrice: null,
        taxRatePercent: 18,
        images: [],
        variants: [
          {
            name: 'Standard 500ml',
            sku: `SKU-STD-${unique('std')}`,
            supplierCost: 40000, // ₹400 + ₹50 ship = ₹450 * 1.5 = ₹675
            sellingPrice: null,
            compareAtPrice: null,
            taxRatePercent: null,
            stock: 20,
            isActive: true,
            sortOrder: 0,
          },
          {
            name: 'Large 1000ml',
            sku: `SKU-LRG-${unique('lrg')}`,
            supplierCost: 60000, // ₹600 + ₹50 ship = ₹650 * 1.5 = ₹975
            sellingPrice: null,
            compareAtPrice: null,
            taxRatePercent: null,
            stock: 15,
            isActive: true,
            sortOrder: 1,
          },
        ],
      },
      { id: null, email: 'test@zenvora.local' }
    );

    try {
      const variants = await prisma.productVariant.findMany({
        where: { productId: saved.id },
        orderBy: { sortOrder: 'asc' },
      });
      expect(variants).toHaveLength(2);
      expect(Number(variants[0]!.sellingPrice)).toBeCloseTo(675, 2);
      expect(Number(variants[1]!.sellingPrice)).toBeCloseTo(975, 2);
    } finally {
      await prisma.product.delete({ where: { id: saved.id } });
    }
  });
});

describe('automated discovery → ranking → quality-gated import → safe bulk publish → fulfilment readiness', () => {
  let demoSupplierId: string;

  beforeAll(async () => {
    const sup = await prisma.supplier.create({
      data: {
        name: `Itest Demo Discovery Supplier ${unique('sup')}`,
        slug: `itest-demo-sup-${unique('slug')}`,
        type: 'DEMO',
        isActive: true,
      },
    });
    demoSupplierId = sup.id;
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { supplierId: demoSupplierId } });
    await prisma.supplierProduct.deleteMany({ where: { supplierId: demoSupplierId } });
    await prisma.setting.deleteMany({
      where: {
        OR: [
          { key: `supplier_sync_report:${demoSupplierId}` },
          { key: `supplier_sync_checkpoint:${demoSupplierId}` },
        ],
      },
    });
    await prisma.supplier.delete({ where: { id: demoSupplierId } });
    await prisma.$disconnect();
  });

  it('discovers catalog items, classifies into HIGH_POTENTIAL / NEEDS_REVIEW / NOT_ELIGIBLE, holds incomplete/prohibited items, and safely bulk-publishes only eligible items', async () => {
    // 1. Run discovery + evaluation (without auto-importing yet)
    const report = await syncAndAutoProcessSupplier({
      supplierId: demoSupplierId,
      limit: 50,
      autoImport: false,
      autoPublishEligible: false,
      actor: { id: null, email: 'admin@zenvora.local' },
    });

    expect(report.status).toBe('COMPLETED');
    expect(report.totals.discovered).toBeGreaterThanOrEqual(8);
    expect(report.totals.created).toBe(report.totals.discovered);
    expect(report.tierCounts.HIGH_POTENTIAL).toBeGreaterThanOrEqual(4);
    expect(report.tierCounts.NEEDS_REVIEW).toBeGreaterThanOrEqual(2);
    expect(report.tierCounts.NOT_ELIGIBLE).toBeGreaterThanOrEqual(1);

    const persistedReport = await getSupplierSyncReport(demoSupplierId);
    expect(persistedReport?.supplierId).toBe(demoSupplierId);

    // 2. Run Safe Bulk Publish on this supplier's discovered rows
    const spRows = await prisma.supplierProduct.findMany({
      where: { supplierId: demoSupplierId },
      select: { id: true, supplierSku: true },
    });

    const bulkRes = await bulkProcessSupplierProducts({
      supplierProductIds: spRows.map((r) => r.id),
      mode: 'SAFE_PUBLISH_ELIGIBLE',
      actor: { id: null, email: 'admin@zenvora.local' },
    });

    // High-potential items pass all 10 quality gates and become PUBLISHED (ACTIVE)
    expect(bulkRes.published).toBeGreaterThanOrEqual(4);
    // Incomplete items (missing shipping SUP-DEMO-012, missing image SUP-DEMO-013) are held as DRAFT / NEEDS_REVIEW
    expect(bulkRes.heldForReview).toBeGreaterThanOrEqual(2);
    // Prohibited item (tactical knife SUP-DEMO-014) is REJECTED and NEVER creates a Product row
    expect(bulkRes.rejected).toBeGreaterThanOrEqual(1);

    const prohibitedSp = await prisma.supplierProduct.findFirst({
      where: { supplierId: demoSupplierId, supplierSku: 'SUP-DEMO-014' },
    });
    expect(prohibitedSp?.productId).toBeNull();

    const missingImgSp = await prisma.supplierProduct.findFirst({
      where: { supplierId: demoSupplierId, supplierSku: 'SUP-DEMO-013' },
      include: { product: true },
    });
    expect(missingImgSp?.product?.status).toBe('DRAFT');

    const neckFanSp = await prisma.supplierProduct.findFirst({
      where: { supplierId: demoSupplierId, supplierSku: 'SUP-DEMO-009' },
      include: { product: { include: { variants: true, images: true } } },
    });
    expect(neckFanSp?.product?.status).toBe('ACTIVE');
    expect(neckFanSp?.product?.images.length).toBeGreaterThanOrEqual(2);
    expect(neckFanSp?.product?.variants.length).toBe(2);
    // Variant 2 had higher supplier cost (₹440 vs ₹420) so its selling price must be >= Variant 1
    const vPrices = neckFanSp!.product!.variants.map((v) => Number(v.sellingPrice));
    expect(vPrices[0]).toBeGreaterThan(0);
    expect(vPrices[1]).toBeGreaterThanOrEqual(vPrices[0]!);

    // 3. Fulfilment readiness report verifies the newly published products are SUPPLIER_READY
    const readiness = await getFulfilmentReadinessReport({ includeDrafts: true });
    const neckFanReady = readiness.items.find((i) => i.productId === neckFanSp!.productId);
    expect(neckFanReady?.ready).toBe(true);
    expect(neckFanReady?.readinessMode).toBe('SUPPLIER_READY');
  });
});
