/**
 * Catalogue Diagnostic Script
 *
 * Run with: tsx scripts/catalogue-diagnostic.ts
 *
 * This script connects to the database and reports the exact state of the
 * product pipeline, answering "why does the shop show zero products?"
 *
 * Requires DATABASE_URL environment variable to be set.
 * READ-ONLY — does not modify any data.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ZENVORA CATALOGUE DIAGNOSTIC');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Database connectivity
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Database connection: OK\n');
  } catch (err) {
    console.log('❌ Database connection: FAILED');
    console.log(`   Error: ${err instanceof Error ? err.message : String(err)}\n`);
    await prisma.$disconnect();
    return;
  }

  // Product counts
  const [
    totalProducts,
    activeProducts,
    activeWithPrice,
    draftProducts,
    archivedProducts,
    zeroPriceProducts,
  ] = await Promise.all([
    prisma.product.count(),
    prisma.product.count({ where: { status: 'ACTIVE' } }),
    prisma.product.count({ where: { status: 'ACTIVE', sellingPrice: { gt: '0' } } }),
    prisma.product.count({ where: { status: 'DRAFT' } }),
    prisma.product.count({ where: { status: 'ARCHIVED' } }),
    prisma.product.count({
      where: {
        OR: [
          { sellingPrice: { lte: '0' } },
        ],
      },
    }),
  ]);

  console.log('── Product Counts ──');
  console.log(`  Total products:              ${totalProducts}`);
  console.log(`  ACTIVE products:             ${activeProducts}`);
  console.log(`  ACTIVE with price > ₹0:     ${activeWithPrice}`);
  console.log(`  DRAFT products:              ${draftProducts}`);
  console.log(`  ARCHIVED products:           ${archivedProducts}`);
  console.log(`  Products with price ≤ ₹0:   ${zeroPriceProducts}`);
  console.log();

  // Supplier data
  const [
    totalSupplierProducts,
    mappedSupplierProducts,
    unmappedSupplierProducts,
    zeroCostSupplierProducts,
    suppliers,
  ] = await Promise.all([
    prisma.supplierProduct.count(),
    prisma.supplierProduct.count({ where: { productId: { not: null } } }),
    prisma.supplierProduct.count({ where: { productId: null } }),
    prisma.supplierProduct.count({ where: { supplierCost: { lte: '0' } } }),
    prisma.supplier.findMany({
      where: { isActive: true },
      select: {
        name: true,
        type: true,
        apiKeyEnvVar: true,
        config: true,
        _count: {
          select: {
            products: true,
            supplierProducts: true,
          },
        },
      },
    }),
  ]);

  console.log('── Supplier Data ──');
  console.log(`  Total SupplierProducts:      ${totalSupplierProducts}`);
  console.log(`  Mapped (linked to Product):  ${mappedSupplierProducts}`);
  console.log(`  Unmapped:                    ${unmappedSupplierProducts}`);
  console.log(`  With zero cost:              ${zeroCostSupplierProducts}`);
  console.log();

  if (suppliers.length === 0) {
    console.log('  ⚠️  NO ACTIVE SUPPLIERS configured.');
    console.log('     → Create a CJ supplier in Admin → Suppliers.');
    console.log('     → Set apiKeyEnvVar to the name of the env var holding the CJ API key.');
    console.log();
  } else {
    console.log('── Active Suppliers ──');
    for (const s of suppliers) {
      const config = (s.config ?? {}) as Record<string, unknown>;
      const cjReady = s.type === 'CJ'
        ? Boolean(s.apiKeyEnvVar?.trim()) && typeof config.fxRateInrPerUsd === 'number'
        : true;
      console.log(`  ${s.name} (${s.type})`);
      console.log(`    Products: ${s._count.products} | SupplierProducts: ${s._count.supplierProducts}`);
      if (s.type === 'CJ') {
        console.log(`    apiKeyEnvVar: ${s.apiKeyEnvVar?.trim() ? '✅ Set' : '❌ NOT SET'}`);
        console.log(`    fxRateInrPerUsd: ${typeof config.fxRateInrPerUsd === 'number' ? `✅ ${config.fxRateInrPerUsd}` : '❌ NOT SET'}`);
        console.log(`    CJ-ready: ${cjReady ? '✅' : '❌'}`);
      }
    }
    console.log();
  }

  // Categories
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    select: {
      name: true,
      slug: true,
      _count: {
        select: {
          products: { where: { status: 'ACTIVE', sellingPrice: { gt: '0' } } },
        },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  console.log('── Categories ──');
  if (categories.length === 0) {
    console.log('  ⚠️  No active categories.');
  } else {
    for (const c of categories) {
      console.log(`  ${c.name} (${c.slug}): ${c._count.products} eligible products`);
    }
  }
  console.log();

  // Pricing rules
  const pricingRules = await prisma.pricingRule.findMany({
    where: { isActive: true },
    select: { name: true, scope: true, mode: true },
  });

  console.log('── Pricing Rules ──');
  if (pricingRules.length === 0) {
    console.log('  ⚠️  No active pricing rules.');
    console.log('     → Products need a pricing rule to compute selling price.');
  } else {
    for (const r of pricingRules) {
      console.log(`  ${r.name} (${r.scope}, ${r.mode})`);
    }
  }
  console.log();

  // Settings
  const settingsRow = await prisma.setting.findUnique({ where: { key: 'store' } });
  const settings = (settingsRow?.value ?? {}) as Record<string, unknown>;
  const autoImport = (settings.autoImport ?? {}) as Record<string, unknown>;

  console.log('── Auto-Import Settings ──');
  console.log(`  Enabled:              ${autoImport.enabled ?? true}`);
  console.log(`  Auto-publish eligible: ${autoImport.autoPublishEligible ?? false}`);
  console.log(`  Daily limit:          ${autoImport.dailyImportLimit ?? 100}`);
  console.log();

  // Sync checkpoint
  const checkpoint = await prisma.setting.findUnique({
    where: { key: 'supplierSyncCheckpoint' },
  });
  if (checkpoint) {
    const cp = checkpoint.value as Record<string, unknown>;
    console.log('── Last Supplier Sync ──');
    console.log(`  Last updated:  ${cp.updatedAt ?? 'unknown'}`);
    console.log(`  In progress:   ${cp.inProgress ?? false}`);
    console.log(`  Source:        ${cp.source ?? 'unknown'}`);
    console.log(`  Cursor:        ${cp.cursor ?? 'none'}`);
    console.log();
  } else {
    console.log('── Last Supplier Sync ──');
    console.log('  ⚠️  No sync checkpoint found. Sync has never been run.');
    console.log();
  }

  // Root cause diagnosis
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  DIAGNOSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (totalProducts === 0) {
    console.log('  ROOT CAUSE: The products table is EMPTY.');
    if (totalSupplierProducts === 0) {
      console.log('  → No supplier data has been synced.');
      if (suppliers.length === 0) {
        console.log('  → No suppliers are configured.');
        console.log('  → ACTION: Create a CJ supplier and configure the API key.');
      } else {
        const cjSupplier = suppliers.find((s) => s.type === 'CJ');
        if (cjSupplier && !cjSupplier.apiKeyEnvVar?.trim()) {
          console.log('  → CJ supplier exists but apiKeyEnvVar is not set.');
          console.log('  → ACTION: Set apiKeyEnvVar on the supplier record.');
        } else {
          console.log('  → ACTION: Run a supplier sync from Admin → Suppliers → Sync.');
        }
      }
    } else {
      console.log(`  → ${totalSupplierProducts} SupplierProducts exist but none have been imported.`);
      if (unmappedSupplierProducts > 0) {
        console.log(`  → ${unmappedSupplierProducts} unmapped supplier products waiting.`);
        console.log('  → ACTION: Run auto-import or manually publish from Admin → Supplier Products.');
      }
    }
  } else if (activeProducts === 0) {
    console.log('  ROOT CAUSE: Products exist but NONE have status ACTIVE.');
    console.log(`  → ${draftProducts} DRAFT, ${archivedProducts} ARCHIVED.`);
    console.log('  → ACTION: Review products in Admin → Products and set eligible ones to ACTIVE.');
  } else if (activeWithPrice === 0) {
    console.log('  ROOT CAUSE: ACTIVE products exist but ALL have sellingPrice ≤ ₹0.');
    console.log('  → ACTION: Run the pricing engine from Admin → Products → Reprice.');
  } else {
    console.log(`  ${activeWithPrice} ACTIVE products with valid prices should appear in the shop.`);
    console.log('  → If the shop still shows "No products found", check:');
    console.log('    1. Server-side caching / ISR revalidation');
    console.log('    2. The listStorefrontProducts query filters');
    console.log('    3. Database connection in production');
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});