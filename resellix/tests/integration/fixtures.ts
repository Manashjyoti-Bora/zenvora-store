import { prisma } from '@/lib/db';

/**
 * Shared fixtures + cleanup for integration tests.
 * Everything created here is namespaced so cleanup can find it:
 *   users/coupons-emails → @itest.local, product slugs → itest-*, coupon codes → ITEST*
 */

export const TEST_DOMAIN = '@itest.local';

let counter = 0;
export function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export function testEmail(prefix = 'user'): string {
  return `${unique(prefix)}${TEST_DOMAIN}`;
}

export interface TestProductOpts {
  name?: string;
  stock?: number;
  sellingPrice?: string; // ₹ decimal string
  supplierCost?: string;
  supplierShippingCost?: string;
  taxRatePercent?: string;
  hasVariants?: boolean;
  variants?: Array<{ name: string; stock: number; sellingPrice?: string; supplierCost?: string }>;
  stockMode?: 'LOCAL' | 'SUPPLIER_SYNC';
}

export async function createTestProduct(opts: TestProductOpts = {}) {
  const id = unique('itest');
  const name = opts.name ?? `Itest Product ${id}`;
  const hasVariants = opts.hasVariants ?? Boolean(opts.variants?.length);
  const product = await prisma.product.create({
    data: {
      name,
      slug: id,
      description: `Integration-test fixture product (${id}). Not part of any real catalog.`,
      sku: id.toUpperCase(),
      status: 'ACTIVE',
      stockMode: opts.stockMode ?? 'LOCAL',
      supplierCost: opts.supplierCost ?? '100.00',
      supplierShippingCost: opts.supplierShippingCost ?? '0.00',
      otherCost: '0.00',
      pricingMode: 'FIXED_PRICE',
      fixedPrice: opts.sellingPrice ?? '250.00',
      sellingPrice: opts.sellingPrice ?? '250.00',
      taxRatePercent: opts.taxRatePercent ?? '0',
      stock: hasVariants ? 0 : (opts.stock ?? 10),
      hasVariants,
      ...(opts.variants?.length
        ? {
            variants: {
              create: opts.variants.map((v, i) => ({
                name: v.name,
                sku: `${id.toUpperCase()}-${i}`,
                stock: v.stock,
                isActive: true,
                sortOrder: i,
                sellingPrice: v.sellingPrice ?? null,
                supplierCost: v.supplierCost ?? null,
              })),
            },
          }
        : {}),
    },
    include: { variants: true },
  });
  return product;
}

export async function createTestSupplier() {
  const id = unique('itest-supplier');
  return prisma.supplier.create({
    data: {
      name: `Itest Supplier ${id}`,
      slug: id,
      type: 'DEMO',
      leadTimeDays: 1,
      isActive: true,
      notes: 'Integration-test fixture (demo simulator).',
    },
  });
}

export async function createTestCoupon(
  over: {
    code?: string;
    type?: 'PERCENT' | 'FIXED';
    value?: string;
    minOrderAmount?: string | null;
    maxDiscountAmount?: string | null;
    usageLimit?: number | null;
  } = {}
) {
  const code = (
    over.code ??
    `ITEST${unique('c')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .slice(0, 10)}`
  ).toUpperCase();
  return prisma.coupon.create({
    data: {
      code,
      type: over.type ?? 'PERCENT',
      value: over.value ?? '10',
      scope: 'ALL_PRODUCTS',
      minOrderAmount: over.minOrderAmount ?? null,
      maxDiscountAmount: over.maxDiscountAmount ?? null,
      usageLimit: over.usageLimit ?? null,
      isActive: true,
    },
  });
}

export const TEST_ADDRESS = {
  fullName: 'Integration Tester',
  phone: '9876543210',
  line1: '9 Test Street',
  city: 'Guwahati',
  state: 'Assam',
  postalCode: '781001',
  country: 'IN',
};

/** Remove every namespaced fixture row (idempotent; FK-safe order). */
export async function cleanupTestData(): Promise<void> {
  await prisma.order.deleteMany({
    where: {
      OR: [
        { guestEmail: { endsWith: TEST_DOMAIN } },
        { user: { email: { endsWith: TEST_DOMAIN } } },
        { items: { some: { product: { slug: { startsWith: 'itest-' } } } } },
      ],
    },
  });
  await prisma.cart.deleteMany({
    where: {
      OR: [
        { user: { email: { endsWith: TEST_DOMAIN } } },
        { items: { some: { product: { slug: { startsWith: 'itest-' } } } } },
      ],
    },
  });
  await prisma.coupon.deleteMany({ where: { code: { startsWith: 'ITEST' } } });
  await prisma.supplier.deleteMany({ where: { slug: { startsWith: 'itest-supplier-' } } });
  await prisma.product.deleteMany({ where: { slug: { startsWith: 'itest-' } } });
  await prisma.notification.deleteMany({ where: { email: { endsWith: TEST_DOMAIN } } });
  await prisma.job.deleteMany({ where: { dedupeKey: { startsWith: 'itest:' } } });
  await prisma.auditLog.deleteMany({ where: { actorEmail: { endsWith: TEST_DOMAIN } } });
  await prisma.passwordResetToken.deleteMany({
    where: { user: { email: { endsWith: TEST_DOMAIN } } },
  });
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_DOMAIN } } });
}
