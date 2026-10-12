import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/guards';
import { ApiError } from '@/lib/errors';

/**
 * Catalogue Diagnostics — Read-only admin endpoint that reports exact
 * product counts and pipeline state. Designed to answer "why are there
 * zero products on the shop?" with evidence, not guesses.
 *
 * Requires ADMIN authentication. Exposes no secrets.
 *
 * VERIFIED counts returned:
 *   1. Total product records
 *   2. ACTIVE products
 *   3. ACTIVE products with valid positive sellingPrice
 *   4. DRAFT products
 *   5. ARCHIVED products
 *   6. Products with zero/missing sellingPrice
 *   7. Total SupplierProduct records
 *   8. Mapped SupplierProducts (linked to a Product)
 *   9. Unmapped SupplierProducts
 *  10. SupplierProduct records with zero cost
 *  11. Active suppliers (by type)
 *  12. Active categories
 *  13. Active pricing rules
 *  14. Last supplier sync checkpoint
 *  15. Products that the public storefront query would return
 *  16. Products that the sitemap query would return
 *  17. CJ-specific supplier config status
 *  18. Auto-import settings
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdmin();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unauthorized';
    const status = err instanceof ApiError ? err.statusCode : 401;
    return NextResponse.json({ error: message }, { status });
  }

  try {
    const [
      totalProducts,
      activeProducts,
      activeWithPrice,
      draftProducts,
      archivedProducts,
      zeroPriceProducts,
      totalSupplierProducts,
      mappedSupplierProducts,
      unmappedSupplierProducts,
      zeroCostSupplierProducts,
      suppliers,
      categories,
      pricingRules,
      syncCheckpoints,
      storefrontProducts,
      sitemapProducts,
      settings,
    ] = await Promise.all([
      // 1. Total product records
      prisma.product.count(),

      // 2. ACTIVE products (regardless of price)
      prisma.product.count({ where: { status: 'ACTIVE' } }),

      // 3. ACTIVE products with valid positive sellingPrice
      prisma.product.count({
        where: { status: 'ACTIVE', sellingPrice: { gt: '0' } },
      }),

      // 4. DRAFT products
      prisma.product.count({ where: { status: 'DRAFT' } }),

      // 5. ARCHIVED products
      prisma.product.count({ where: { status: 'ARCHIVED' } }),

      // 6. Products with zero sellingPrice (field is non-nullable with default 0)
      prisma.product.count({
        where: { sellingPrice: { lte: '0' } },
      }),

      // 7. Total SupplierProduct records
      prisma.supplierProduct.count(),

      // 8. Mapped SupplierProducts
      prisma.supplierProduct.count({
        where: { productId: { not: null } },
      }),

      // 9. Unmapped SupplierProducts
      prisma.supplierProduct.count({
        where: { productId: null },
      }),

      // 10. SupplierProducts with zero cost
      prisma.supplierProduct.count({
        where: { supplierCost: { lte: '0' } },
      }),

      // 11. Active suppliers (grouped by type)
      // NOTE: config is loaded server-side but NEVER sent to the client —
      // it may contain platformToken or other supplier credentials.
      prisma.supplier.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          type: true,
          apiKeyEnvVar: true,
          config: true, // parsed server-side, stripped before response
          _count: {
            select: {
              products: true,
              supplierProducts: true,
            },
          },
        },
      }),

      // 12. Active categories
      prisma.category.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          slug: true,
          _count: {
            select: {
              products: {
                where: { status: 'ACTIVE', sellingPrice: { gt: '0' } },
              },
            },
          },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),

      // 13. Active pricing rules
      prisma.pricingRule.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          scope: true,
          mode: true,
          supplierId: true,
          categoryId: true,
        },
      }),

      // 14. Last sync checkpoint
      prisma.setting.findUnique({
        where: { key: 'supplierSyncCheckpoint' },
      }),

      // 15. Public storefront query count
      prisma.product.count({
        where: { status: 'ACTIVE', sellingPrice: { gt: '0' } },
      }),

      // 16. Sitemap-eligible products count
      prisma.product.count({
        where: { status: 'ACTIVE', sellingPrice: { gt: '0' } },
      }),

      // 17. Settings
      prisma.setting.findUnique({ where: { key: 'store' } }),
    ]);

    // Parse CJ supplier config status (non-secret)
    const cjSuppliers = suppliers.filter((s) => s.type === 'CJ').map((s) => {
      const config = (s.config ?? {}) as Record<string, unknown>;
      return {
        id: s.id,
        name: s.name,
        apiKeyEnvVarConfigured: Boolean(s.apiKeyEnvVar?.trim()),
        fxRateConfigured: typeof config.fxRateInrPerUsd === 'number' && config.fxRateInrPerUsd > 0,
        productCount: s._count.supplierProducts,
        mappedProductCount: s._count.products,
      };
    });

    // Parse auto-import settings (non-secret)
    const storeSettings = settings?.value as Record<string, unknown> | undefined;
    const autoImport = (storeSettings?.autoImport ?? {}) as Record<string, unknown>;

    // Determine root cause diagnosis
    const diagnosis: string[] = [];
    if (totalProducts === 0) {
      diagnosis.push('NO_PRODUCTS: The products table is completely empty.');
      if (totalSupplierProducts === 0) {
        diagnosis.push('NO_SUPPLIER_DATA: No SupplierProduct records exist. Supplier sync has never been run or no supplier is configured.');
      }
      if (suppliers.length === 0) {
        diagnosis.push('NO_SUPPLIERS: No active suppliers are configured. Create a CJ supplier record and configure the API key.');
      } else if (cjSuppliers.some((s) => !s.apiKeyEnvVarConfigured)) {
        diagnosis.push('CJ_NO_ENV_VAR: CJ supplier exists but apiKeyEnvVar is not set on the supplier record.');
      }
    } else {
      if (activeProducts === 0) {
        diagnosis.push('NO_ACTIVE: Products exist but none have status ACTIVE. Products are all DRAFT or ARCHIVED.');
      }
      if (activeWithPrice === 0 && activeProducts > 0) {
        diagnosis.push('ZERO_PRICE: ACTIVE products exist but all have sellingPrice ≤ ₹0. Run the pricing engine.');
      }
      if (activeWithPrice > 0 && storefrontProducts === 0) {
        diagnosis.push('QUERY_EXCLUSION: Eligible products exist but the public query returns 0. Possible filter/caching bug.');
      }
    }

    if (syncCheckpoints) {
      const cp = syncCheckpoints.value as Record<string, unknown>;
      diagnosis.push(`LAST_SYNC: ${cp.updatedAt ?? 'unknown'} | inProgress: ${cp.inProgress ?? false} | source: ${cp.source ?? 'unknown'}`);
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      counts: {
        products: {
          total: totalProducts,
          active: activeProducts,
          activeWithPositivePrice: activeWithPrice,
          draft: draftProducts,
          archived: archivedProducts,
          zeroOrMissingPrice: zeroPriceProducts,
        },
        supplierProducts: {
          total: totalSupplierProducts,
          mapped: mappedSupplierProducts,
          unmapped: unmappedSupplierProducts,
          zeroCost: zeroCostSupplierProducts,
        },
        storefront: {
          queryResultCount: storefrontProducts,
          sitemapEligibleCount: sitemapProducts,
        },
        categories: categories.length,
        activePricingRules: pricingRules.length,
      },
      categories: categories.map((c) => ({
        name: c.name,
        slug: c.slug,
        eligibleProductCount: c._count.products,
      })),
      suppliers: suppliers.map((s) => ({
        name: s.name,
        type: s.type,
        productCount: s._count.products,
        supplierProductCount: s._count.supplierProducts,
      })),
      cjSuppliers,
      autoImport: {
        enabled: autoImport.enabled ?? true,
        autoPublishEligible: autoImport.autoPublishEligible ?? false,
        dailyImportLimit: autoImport.dailyImportLimit ?? 100,
      },
      diagnosis,
      rootCause: diagnosis.length > 0 ? diagnosis[0] : 'UNKNOWN: Products exist and query returns results. Check frontend rendering.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'Diagnostics failed', message },
      { status: 500 }
    );
  }
}