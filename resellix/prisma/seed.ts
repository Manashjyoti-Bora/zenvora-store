/**
 * Resellix demo seed.
 *
 * WHAT THIS CREATES (all clearly demo data, catalog-only):
 *   - 1 admin user (credentials come from ADMIN_EMAIL / ADMIN_PASSWORD env vars —
 *     this script never hardcodes or invents credentials)
 *   - store settings with demoMode = true (drives the storefront DEMO banner)
 *   - 1 demo supplier (type DEMO — the built-in simulator, never a real partner)
 *   - 3 categories, 8 products (2 with variants) with locally generated
 *     placeholder images labelled "DEMO IMAGE"
 *   - supplier catalog entries mapped to those products
 *   - 2 example coupons + 1 DISABLED example pricing rule
 *
 * WHAT THIS NEVER CREATES: orders, payments, refunds, customers, reviews or any
 * other transactional "history" — fake orders would violate the no-fake-data
 * rule. Place real test orders through the storefront with the TEST provider.
 *
 * SAFETY: refuses to run against NODE_ENV=production unless FORCE_SEED=1.
 * Idempotent: re-running upserts by slug/sku/code and does not reset an
 * existing admin's password.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { prisma } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth/password';
import { computePricing } from '../src/lib/pricing/engine';
import { updateSettings } from '../src/lib/settings';
import type { Prisma } from '@prisma/client';

const rupees = (paise: number) => (paise / 100).toFixed(2);

interface SeedVariant {
  name: string;
  sku: string;
  size?: string;
  color?: string;
  supplierCost?: number; // ₹ override
  stock: number;
}

interface SeedProduct {
  name: string;
  slug: string;
  sku: string;
  categorySlug: string;
  shortDescription: string;
  description: string;
  supplierCost: number; // ₹
  supplierShipping: number; // ₹
  percentMarkup: number;
  gstPercent: number;
  minProfit: number; // ₹
  weightGrams?: number;
  stock?: number; // only when no variants
  variants?: SeedVariant[];
}

const CATEGORIES = [
  { name: 'Electronics', slug: 'electronics', sortOrder: 0 },
  { name: 'Home & Kitchen', slug: 'home-kitchen', sortOrder: 1 },
  { name: 'Fashion Accessories', slug: 'fashion-accessories', sortOrder: 2 },
];

const PRODUCTS: SeedProduct[] = [
  {
    name: 'Wireless Bluetooth Earbuds',
    slug: 'wireless-bluetooth-earbuds',
    sku: 'DEMO-EARBUDS',
    categorySlug: 'electronics',
    shortDescription: 'True-wireless earbuds with charging case, touch controls and 6 mm drivers.',
    description:
      'True-wireless Bluetooth 5.3 earbuds with a pocketable charging case. Touch controls for playback and calls, 6 mm dynamic drivers, and built-in microphones for hands-free calls.\n\nWhat is in the box: earbud pair, charging case, USB-C cable, three pairs of ear tips.\n\nDemo catalog item — replace this listing with your real supplier feed before launch.',
    supplierCost: 850,
    supplierShipping: 40,
    percentMarkup: 45,
    gstPercent: 18,
    minProfit: 120,
    weightGrams: 120,
    variants: [
      { name: 'Black', sku: 'DEMO-EARBUDS-BLK', color: 'Black', stock: 25 },
      { name: 'White', sku: 'DEMO-EARBUDS-WHT', color: 'White', supplierCost: 870, stock: 18 },
    ],
  },
  {
    name: 'USB-C Fast Charger 65 W',
    slug: 'usb-c-fast-charger-65w',
    sku: 'DEMO-CHG65',
    categorySlug: 'electronics',
    shortDescription: 'Single-port GaN charger — 65 W PD, fast-charges laptops and phones.',
    description:
      'Compact GaN USB-C wall charger with 65 W Power Delivery. Charges compatible laptops at full speed and fast-charges phones and tablets. Foldable pins, BIS-marked plug (verify certification for your sourcing batch).\n\nDemo catalog item — replace this listing with your real supplier feed before launch.',
    supplierCost: 620,
    supplierShipping: 35,
    percentMarkup: 40,
    gstPercent: 18,
    minProfit: 100,
    weightGrams: 140,
    stock: 40,
  },
  {
    name: 'Stainless Steel Water Bottle 1 L',
    slug: 'stainless-steel-water-bottle-1l',
    sku: 'DEMO-BOTTLE1L',
    categorySlug: 'home-kitchen',
    shortDescription: 'Double-wall vacuum insulated bottle — keeps drinks cold 24 h / hot 12 h.',
    description:
      '1 litre double-wall vacuum insulated bottle in food-grade 304 stainless steel. Keeps drinks cold for up to 24 hours or hot for up to 12 hours. Leak-proof lid, fits standard cup holders.\n\nDemo catalog item — replace this listing with your real supplier feed before launch.',
    supplierCost: 340,
    supplierShipping: 45,
    percentMarkup: 50,
    gstPercent: 18,
    minProfit: 80,
    weightGrams: 540,
    variants: [
      { name: 'Steel', sku: 'DEMO-BOTTLE1L-STL', color: 'Steel', stock: 60 },
      { name: 'Midnight Blue', sku: 'DEMO-BOTTLE1L-BLU', color: 'Midnight Blue', stock: 35 },
    ],
  },
  {
    name: 'Ceramic Dinner Set (12 pieces)',
    slug: 'ceramic-dinner-set-12-pieces',
    sku: 'DEMO-DINNER12',
    categorySlug: 'home-kitchen',
    shortDescription:
      'Service for four: 4 dinner plates, 4 side plates, 4 bowls. Microwave & dishwasher safe.',
    description:
      'Twelve-piece ceramic dinner set serving four: dinner plates, side plates and bowls with a matte glaze finish. Microwave and dishwasher safe; packed with double-wall boxing for courier transit.\n\nDemo catalog item — replace this listing with your real supplier feed before launch.',
    supplierCost: 1150,
    supplierShipping: 120,
    percentMarkup: 35,
    gstPercent: 18,
    minProfit: 200,
    weightGrams: 4800,
    stock: 12,
  },
  {
    name: 'Cotton Tote Bag',
    slug: 'cotton-tote-bag',
    sku: 'DEMO-TOTE',
    categorySlug: 'fashion-accessories',
    shortDescription: 'Sturdy 12-oz cotton canvas tote with inner pocket and long handles.',
    description:
      'Everyday tote in 12-oz cotton canvas with reinforced stitching, an inner zip pocket and shoulder-length handles. Machine washable, undyed natural canvas.\n\nDemo catalog item — replace this listing with your real supplier feed before launch.',
    supplierCost: 180,
    supplierShipping: 25,
    percentMarkup: 60,
    gstPercent: 5,
    minProfit: 40,
    weightGrams: 220,
    stock: 100,
  },
  {
    name: 'Analog Wall Clock 12-inch',
    slug: 'analog-wall-clock-12-inch',
    sku: 'DEMO-CLOCK12',
    categorySlug: 'home-kitchen',
    shortDescription: 'Silent sweep movement, minimalist dial, runs 6+ months on one AA cell.',
    description:
      '12-inch wall clock with a silent sweep (non-ticking) movement and a clean minimalist dial. Runs for six months or more on a single AA battery (not included). Includes wall-mount hardware.\n\nDemo catalog item — replace this listing with your real supplier feed before launch.',
    supplierCost: 410,
    supplierShipping: 60,
    percentMarkup: 45,
    gstPercent: 18,
    minProfit: 90,
    weightGrams: 700,
    stock: 22,
  },
  {
    name: 'Laptop Sleeve 15.6-inch',
    slug: 'laptop-sleeve-15-6-inch',
    sku: 'DEMO-SLEEVE156',
    categorySlug: 'electronics',
    shortDescription:
      'Padded water-resistant sleeve with accessory pocket, fits most 15.6" laptops.',
    description:
      'Slim padded sleeve for laptops up to 15.6 inches, in water-resistant fabric with a soft fleece lining and a front accessory pocket for chargers and cables.\n\nDemo catalog item — replace this listing with your real supplier feed before launch.',
    supplierCost: 290,
    supplierShipping: 30,
    percentMarkup: 55,
    gstPercent: 18,
    minProfit: 60,
    weightGrams: 260,
    stock: 48,
  },
  {
    name: 'Bifold Wallet (vegan leather)',
    slug: 'bifold-wallet-vegan-leather',
    sku: 'DEMO-WALLET',
    categorySlug: 'fashion-accessories',
    shortDescription: 'Slim bifold with 6 card slots, 2 note compartments and an ID window.',
    description:
      'Slim bifold wallet in vegan leather: six card slots, two note compartments, one ID window and an RFID-blocking lining. This listing is intentionally seeded as SOLD OUT so you can see out-of-stock behaviour on the storefront.\n\nDemo catalog item — replace this listing with your real supplier feed before launch.',
    supplierCost: 350,
    supplierShipping: 20,
    percentMarkup: 50,
    gstPercent: 12,
    minProfit: 70,
    weightGrams: 90,
    stock: 0,
  },
];

function placeholderSvg(name: string, initials: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">
  <rect width="800" height="800" fill="#e8f1eb"/>
  <rect x="24" y="24" width="752" height="752" rx="32" fill="none" stroke="#35885d" stroke-width="6" stroke-dasharray="26 18"/>
  <circle cx="400" cy="340" r="150" fill="#35885d" opacity="0.12"/>
  <text x="400" y="392" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="140" font-weight="bold" fill="#20573c">${initials}</text>
  <text x="400" y="560" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="bold" fill="#20573c">DEMO IMAGE</text>
  <text x="400" y="612" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="28" fill="#4b6356">${name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>
  <text x="400" y="660" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="#7c8d83">Replace with real product photos before launch</text>
</svg>
`;
}

function initialsOf(name: string): string {
  return name
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.FORCE_SEED !== '1') {
    throw new Error(
      'Refusing to seed demo data in production. If you really mean it, re-run with FORCE_SEED=1.'
    );
  }

  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    throw new Error(
      'ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env — the seed never invents credentials. ' +
        'See .env.example.'
    );
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log(' RESELLIX DEMO SEED — catalog data only, clearly marked');
  console.log('═══════════════════════════════════════════════════════════');

  // ── Admin user ────────────────────────────────────────────────────────────
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existingAdmin) {
    console.log(`• admin user exists (${adminEmail}) — password left untouched`);
  } else {
    await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'Store Admin',
        passwordHash: await hashPassword(adminPassword),
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    console.log(`• created admin user ${adminEmail} (password from ADMIN_PASSWORD env var)`);
  }

  // ── Store settings (demoMode ON) ─────────────────────────────────────────
  await updateSettings({
    storeName: process.env.APP_NAME ?? 'Resellix',
    storeTagline: 'Curated picks, delivered across India',
    supportEmail: adminEmail,
    supportPhone: '',
    currency: 'INR',
    demoMode: true,
    announcement: null,
    payments: { feePercent: 2, feeFixedPaise: 0 },
    shipping: {
      flatRatePaise: 4900,
      freeAbovePaise: 99900,
      codEnabled: true,
      codFeePaise: 2000,
      estimatedDaysMin: 3,
      estimatedDaysMax: 7,
    },
    tax: { defaultGstPercent: 18, pricesIncludeTax: true, invoicePrefix: 'INV' },
    policies: { returnWindowDays: 7, cancellationWindowHours: 24 },
    business: { legalName: '', gstin: '', addressLine: '', city: '', state: '', postalCode: '' },
    social: { instagram: '', facebook: '', youtube: '' },
  });
  console.log('• store settings written (demoMode=true, COD enabled, GST-inclusive prices)');

  // ── Demo supplier ─────────────────────────────────────────────────────────
  const supplier = await prisma.supplier.upsert({
    where: { slug: 'demo-supplier' },
    update: { isActive: true, type: 'DEMO' },
    create: {
      name: 'Demo Supplier (simulated)',
      slug: 'demo-supplier',
      type: 'DEMO',
      leadTimeDays: 3,
      isActive: true,
      notes:
        'Built-in simulator for development: accepts supplier orders, ships them on a schedule and reports tracking. All data is clearly demo. Replace with a real supplier adapter (MANUAL or HTTP_REST) before launch.',
    },
  });
  console.log(`• demo supplier ready (${supplier.type})`);

  // ── Categories ────────────────────────────────────────────────────────────
  const catBySlug = new Map<string, string>();
  for (const c of CATEGORIES) {
    const row = await prisma.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name, sortOrder: c.sortOrder, isActive: true },
      create: { ...c, isActive: true },
    });
    catBySlug.set(c.slug, row.id);
  }
  console.log(`• ${CATEGORIES.length} categories upserted`);

  // ── Placeholder images on disk ────────────────────────────────────────────
  const imgDir = path.join(process.cwd(), 'public', 'uploads', 'seed');
  fs.mkdirSync(imgDir, { recursive: true });

  // ── Products ──────────────────────────────────────────────────────────────
  let productCount = 0;
  let variantCount = 0;
  let catalogCount = 0;

  for (const p of PRODUCTS) {
    const imgFile = `demo-${p.slug}.svg`;
    fs.writeFileSync(
      path.join(imgDir, imgFile),
      placeholderSvg(p.name, initialsOf(p.name)),
      'utf8'
    );
    const imgUrl = `/uploads/seed/${imgFile}`;

    const variants = p.variants ?? [];
    const variantPrices = variants.map((v) => {
      const cost = v.supplierCost ?? p.supplierCost;
      const b = computePricing({
        supplierCostPaise: Math.round(cost * 100),
        supplierShippingPaise: Math.round(p.supplierShipping * 100),
        otherCostPaise: 0,
        mode: 'PERCENT_MARKUP',
        percentMarkup: p.percentMarkup,
        minProfitPaise: Math.round(p.minProfit * 100),
        roundingRule: 'ROUND_UP_10',
        paymentFeePercent: 2,
        paymentFeeFixedPaise: 0,
        taxRatePercent: p.gstPercent,
      });
      return { variant: v, breakdown: b };
    });

    const productBreakdown = computePricing({
      supplierCostPaise: Math.round(p.supplierCost * 100),
      supplierShippingPaise: Math.round(p.supplierShipping * 100),
      otherCostPaise: 0,
      mode: 'PERCENT_MARKUP',
      percentMarkup: p.percentMarkup,
      minProfitPaise: Math.round(p.minProfit * 100),
      roundingRule: 'ROUND_UP_10',
      paymentFeePercent: 2,
      paymentFeeFixedPaise: 0,
      taxRatePercent: p.gstPercent,
    });

    // Listing price = cheapest variant when variants exist (storefront "from ₹X").
    const sellingPricePaise = variantPrices.length
      ? Math.min(...variantPrices.map((v) => v.breakdown.sellingPricePaise))
      : productBreakdown.sellingPricePaise;

    const supplierSku = `SP-${p.sku}`;
    const totalStock = variants.length ? variants.reduce((a, v) => a + v.stock, 0) : (p.stock ?? 0);

    const baseFields = {
      name: p.name,
      description: p.description,
      shortDescription: p.shortDescription,
      sku: p.sku,
      brand: 'DemoBrand',
      status: 'ACTIVE' as const,
      category: { connect: { id: catBySlug.get(p.categorySlug)! } },
      supplier: { connect: { id: supplier.id } },
      supplierSku,
      stockMode: 'LOCAL' as const,
      supplierCost: p.supplierCost.toFixed(2),
      supplierShippingCost: p.supplierShipping.toFixed(2),
      otherCost: '0.00',
      pricingMode: 'PERCENT_MARKUP' as const,
      percentMarkup: String(p.percentMarkup),
      minProfit: p.minProfit.toFixed(2),
      roundingRule: 'ROUND_UP_10' as const,
      sellingPrice: rupees(sellingPricePaise),
      taxRatePercent: String(p.gstPercent),
      stock: variants.length ? 0 : (p.stock ?? 0),
      hasVariants: variants.length > 0,
      weightGrams: p.weightGrams ?? null,
      seoTitle: `Buy ${p.name} online in India`,
      seoDescription: p.shortDescription.slice(0, 155),
    };

    const imageRow = {
      url: imgUrl,
      alt: `${p.name} — demo placeholder image`,
      position: 0,
      isPrimary: true,
    };

    const variantRows = variantPrices.map(({ variant: v, breakdown: b }, i) => ({
      name: v.name,
      sku: v.sku,
      size: v.size ?? null,
      color: v.color ?? null,
      supplierCost: (v.supplierCost ?? p.supplierCost).toFixed(2),
      supplierShippingCost: p.supplierShipping.toFixed(2),
      sellingPrice: rupees(b.sellingPricePaise),
      taxRatePercent: String(p.gstPercent),
      stock: v.stock,
      isActive: true,
      sortOrder: i,
    }));

    const existing = await prisma.product.findUnique({ where: { slug: p.slug } });
    let productId: string;
    if (existing) {
      await prisma.product.update({ where: { id: existing.id }, data: baseFields });
      productId = existing.id;
      // refresh the placeholder image without duplicating rows
      await prisma.productImage.deleteMany({ where: { productId } });
      await prisma.productImage.create({ data: { productId, ...imageRow } });
      for (const v of variantRows) {
        const { sku, ...variantUpdate } = v;
        await prisma.productVariant.upsert({
          where: { sku },
          update: variantUpdate,
          create: { productId, ...v },
        });
      }
    } else {
      const created = await prisma.product.create({
        data: {
          ...baseFields,
          slug: p.slug,
          images: { create: [imageRow] },
          ...(variantRows.length ? { variants: { create: variantRows } } : {}),
        },
      });
      productId = created.id;
    }
    productCount += 1;
    variantCount += variants.length;

    // supplier catalog entry mapped to the product
    await prisma.supplierProduct.upsert({
      where: { supplierId_supplierSku: { supplierId: supplier.id, supplierSku } },
      update: {
        productId,
        supplierCost: p.supplierCost.toFixed(2),
        supplierShippingCost: p.supplierShipping.toFixed(2),
        stockQty: totalStock,
        inStock: totalStock > 0,
        isActive: true,
        lastSyncedAt: new Date(),
      },
      create: {
        supplierId: supplier.id,
        productId,
        supplierSku,
        supplierCost: p.supplierCost.toFixed(2),
        supplierShippingCost: p.supplierShipping.toFixed(2),
        currency: 'INR',
        stockQty: totalStock,
        inStock: totalStock > 0,
        isActive: true,
        lastSyncedAt: new Date(),
        raw: { demo: true, seeded: true, name: p.name },
      },
    });
    catalogCount += 1;
    console.log(
      `• ${p.name}: selling ₹${rupees(sellingPricePaise)} (cost ₹${p.supplierCost} + ship ₹${p.supplierShipping}, ${p.percentMarkup}% markup, GST ${p.gstPercent}%)`
    );
  }

  // ── Example coupons ───────────────────────────────────────────────────────
  const now = new Date();
  const coupons: Prisma.CouponCreateInput[] = [
    {
      code: 'WELCOME10',
      type: 'PERCENT',
      value: '10',
      scope: 'ALL_PRODUCTS',
      minOrderAmount: '499',
      maxDiscountAmount: '150',
      usageLimit: 1000,
      perUserLimit: 1,
      startsAt: now,
      endsAt: new Date(now.getTime() + 90 * 864e5),
      isActive: true,
    },
    {
      code: 'DEMOFLAT50',
      type: 'FIXED',
      value: '50',
      scope: 'ALL_PRODUCTS',
      minOrderAmount: '399',
      startsAt: now,
      endsAt: new Date(now.getTime() + 30 * 864e5),
      isActive: true,
    },
  ];
  for (const c of coupons) {
    await prisma.coupon.upsert({
      where: { code: c.code },
      update: { isActive: true, endsAt: c.endsAt },
      create: c,
    });
  }
  console.log(`• ${coupons.length} example coupons (WELCOME10, DEMOFLAT50)`);

  // ── Example pricing rule (DISABLED so it never silently reprices) ─────────
  await prisma.pricingRule.upsert({
    where: { id: 'seed-example-global-rule' },
    update: {},
    create: {
      id: 'seed-example-global-rule',
      name: 'Example — global 35% markup (disabled)',
      scope: 'GLOBAL',
      mode: 'PERCENT_MARKUP',
      percentMarkup: '35',
      roundingRule: 'ROUND_UP_10',
      priority: 0,
      isActive: false,
    },
  });
  console.log('• 1 example pricing rule (kept DISABLED — enable from Admin → Pricing rules)');

  console.log('───────────────────────────────────────────────────────────');
  console.log(
    `Seeded: ${productCount} products, ${variantCount} variants, ${catalogCount} supplier catalog entries.`
  );
  console.log('DEMO DATA NOTICE: every item above is seed/demo content (demoMode=true).');
  console.log('No orders, payments or customers were created — place test orders via the');
  console.log('storefront using the TEST payment provider (non-production only).');
  console.log(`Admin login: ${adminEmail} (password from ADMIN_PASSWORD in .env)`);
  console.log('───────────────────────────────────────────────────────────');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
