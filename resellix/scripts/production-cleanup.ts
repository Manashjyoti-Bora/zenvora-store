/**
 * Pre-production demo-data cleanup (Phase 19 procedure).
 *
 *   npm run cleanup:demo                → DRY RUN (prints what would be deleted)
 *   npm run cleanup:demo -- --execute   → actually deletes
 *
 * What it removes (default):
 *   1. ALL transactional data: orders, order items, payments, refunds, returns,
 *      shipments + tracking events, supplier orders, webhook events, order
 *      events, coupon redemptions, notifications, jobs, carts + items,
 *      sessions, password-reset tokens, addresses, audit/API/error logs,
 *      contact messages.  (Before launch none of this is real; anything here
 *      is test data from acceptance runs.)
 *   2. Test users: every user whose email ends in a known test domain
 *      (@e2e.example, @example.com, @example.org, @test.invalid).
 *      The admin account (ADMIN_EMAIL) is ALWAYS kept.
 *   3. Demo catalog: products with SKU prefix "DEMO-", their variants/images,
 *      DEMO-type suppliers and their supplier-product entries, and the seeded
 *      example coupons (WELCOME10, DEMOFLAT50).
 *   4. Demo seed images under public/uploads/seed/demo-*.
 *   5. Flips settings.demoMode to false (the storefront demo banner).
 *
 * What it KEEPS (unless extra flags):
 *   - Admin user; non-test customer accounts (see --delete-all-users)
 *   - Real (non-DEMO) products/suppliers/categories/pricing rules/coupons
 *   - Settings (other than demoMode), notification templates
 *
 * Extra flags:
 *   --include-real-catalog   also delete non-demo products/suppliers/categories
 *   --delete-all-users       also delete every non-admin user (GDPR-style clean slate)
 *   --keep-demo-files        do not touch public/uploads/seed
 *
 * SAFETY: without --execute this script only counts and prints. Deletions run
 * in FK-safe child→parent order inside sequential deleteMany calls.
 */
import fs from 'node:fs';
import path from 'node:path';

import { prisma } from '../src/lib/db';

const TEST_EMAIL_DOMAINS = ['e2e.example', 'example.com', 'example.org', 'test.invalid'];
const testUserCondition = {
  OR: TEST_EMAIL_DOMAINS.map((d) => ({ email: { endsWith: `@${d}` } })),
};
const DEMO_COUPON_CODES = ['WELCOME10', 'DEMOFLAT50'];

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const INCLUDE_REAL_CATALOG = args.includes('--include-real-catalog');
const DELETE_ALL_USERS = args.includes('--delete-all-users');
const KEEP_DEMO_FILES = args.includes('--keep-demo-files');

const adminEmail = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();

function demoFileList(): string[] {
  const dir = path.resolve(process.cwd(), 'public/uploads/seed');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('demo-'))
    .map((f) => path.join(dir, f));
}

/** child → parent; every entry: [label, countFn, deleteFn] */
type Step = {
  label: string;
  count: () => Promise<number>;
  del: () => Promise<number>;
};

function userWhere() {
  const notAdmin = { NOT: { email: { equals: adminEmail, mode: 'insensitive' as const } } };
  return DELETE_ALL_USERS ? notAdmin : { AND: [testUserCondition, notAdmin] };
}

async function main() {
  console.log('──────────────────────────────────────────────────────────────');
  console.log(EXECUTE ? '⚠️  EXECUTE MODE — data WILL be deleted' : 'DRY RUN — nothing will be deleted (pass --execute to apply)');
  console.log(`Target database: ${String(process.env.DATABASE_URL ?? '').replace(/:[^:@/]+@/, ':****@')}`);
  console.log(`Admin account kept: ${adminEmail || '(ADMIN_EMAIL not set!)'}`);
  console.log('──────────────────────────────────────────────────────────────');

  const demoProductCondition = INCLUDE_REAL_CATALOG ? {} : { sku: { startsWith: 'DEMO-' } };
  const demoSupplierCondition = INCLUDE_REAL_CATALOG ? {} : { type: 'DEMO' as const };

  const steps: Step[] = [
    // ── 1. transactional data (all of it — pre-launch it is all test data) ──
    { label: 'tracking events', count: () => prisma.trackingEvent.count(), del: async () => (await prisma.trackingEvent.deleteMany({})).count },
    { label: 'shipments', count: () => prisma.shipment.count(), del: async () => (await prisma.shipment.deleteMany({})).count },
    { label: 'return requests', count: () => prisma.returnRequest.count(), del: async () => (await prisma.returnRequest.deleteMany({})).count },
    { label: 'refunds', count: () => prisma.refund.count(), del: async () => (await prisma.refund.deleteMany({})).count },
    { label: 'webhook events', count: () => prisma.webhookEvent.count(), del: async () => (await prisma.webhookEvent.deleteMany({})).count },
    { label: 'payments', count: () => prisma.payment.count(), del: async () => (await prisma.payment.deleteMany({})).count },
    { label: 'supplier orders', count: () => prisma.supplierOrder.count(), del: async () => (await prisma.supplierOrder.deleteMany({})).count },
    { label: 'order events', count: () => prisma.orderEvent.count(), del: async () => (await prisma.orderEvent.deleteMany({})).count },
    { label: 'order items', count: () => prisma.orderItem.count(), del: async () => (await prisma.orderItem.deleteMany({})).count },
    { label: 'orders', count: () => prisma.order.count(), del: async () => (await prisma.order.deleteMany({})).count },
    { label: 'coupon redemptions', count: () => prisma.couponRedemption.count(), del: async () => (await prisma.couponRedemption.deleteMany({})).count },
    { label: 'notifications', count: () => prisma.notification.count(), del: async () => (await prisma.notification.deleteMany({})).count },
    { label: 'jobs', count: () => prisma.job.count(), del: async () => (await prisma.job.deleteMany({})).count },
    { label: 'audit logs', count: () => prisma.auditLog.count(), del: async () => (await prisma.auditLog.deleteMany({})).count },
    { label: 'api logs', count: () => prisma.apiLog.count(), del: async () => (await prisma.apiLog.deleteMany({})).count },
    { label: 'error logs', count: () => prisma.errorLog.count(), del: async () => (await prisma.errorLog.deleteMany({})).count },
    { label: 'contact messages', count: () => prisma.contactMessage.count(), del: async () => (await prisma.contactMessage.deleteMany({})).count },
    { label: 'cart items', count: () => prisma.cartItem.count(), del: async () => (await prisma.cartItem.deleteMany({})).count },
    { label: 'carts', count: () => prisma.cart.count(), del: async () => (await prisma.cart.deleteMany({})).count },
    { label: 'sessions', count: () => prisma.session.count(), del: async () => (await prisma.session.deleteMany({})).count },
    { label: 'password reset tokens', count: () => prisma.passwordResetToken.count(), del: async () => (await prisma.passwordResetToken.deleteMany({})).count },
    { label: 'addresses', count: () => prisma.address.count(), del: async () => (await prisma.address.deleteMany({})).count },

    // ── 2. users ──
    {
      label: DELETE_ALL_USERS ? 'ALL non-admin users' : 'test-domain users',
      count: () => prisma.user.count({ where: userWhere() }),
      del: async () => (await prisma.user.deleteMany({ where: userWhere() })).count,
    },

    // ── 3. demo catalog ──
    {
      label: INCLUDE_REAL_CATALOG ? 'ALL product images' : 'demo product images',
      count: () => prisma.productImage.count({ where: { product: demoProductCondition } }),
      del: async () => (await prisma.productImage.deleteMany({ where: { product: demoProductCondition } })).count,
    },
    {
      label: INCLUDE_REAL_CATALOG ? 'ALL product variants' : 'demo product variants',
      count: () => prisma.productVariant.count({ where: { product: demoProductCondition } }),
      del: async () => (await prisma.productVariant.deleteMany({ where: { product: demoProductCondition } })).count,
    },
    {
      label: INCLUDE_REAL_CATALOG ? 'ALL supplier catalog entries' : 'demo supplier catalog entries',
      count: () =>
        prisma.supplierProduct.count({
          where: INCLUDE_REAL_CATALOG ? {} : { OR: [{ supplier: { type: 'DEMO' } }, { product: { sku: { startsWith: 'DEMO-' } } }] },
        }),
      del: async () =>
        (
          await prisma.supplierProduct.deleteMany({
            where: INCLUDE_REAL_CATALOG ? {} : { OR: [{ supplier: { type: 'DEMO' } }, { product: { sku: { startsWith: 'DEMO-' } } }] },
          })
        ).count,
    },
    {
      label: INCLUDE_REAL_CATALOG ? 'ALL products' : 'demo products (SKU DEMO-*)',
      count: () => prisma.product.count({ where: demoProductCondition }),
      del: async () => (await prisma.product.deleteMany({ where: demoProductCondition })).count,
    },
    {
      label: INCLUDE_REAL_CATALOG ? 'ALL suppliers' : 'DEMO-type suppliers',
      count: () => prisma.supplier.count({ where: demoSupplierCondition }),
      del: async () => (await prisma.supplier.deleteMany({ where: demoSupplierCondition })).count,
    },
    {
      label: INCLUDE_REAL_CATALOG ? 'ALL categories' : 'categories (kept unless --include-real-catalog)',
      count: async () => (INCLUDE_REAL_CATALOG ? prisma.category.count() : 0),
      del: async () => (INCLUDE_REAL_CATALOG ? (await prisma.category.deleteMany({})).count : 0),
    },
    {
      label: 'seeded example coupons (WELCOME10, DEMOFLAT50)',
      count: () => prisma.coupon.count({ where: { code: { in: DEMO_COUPON_CODES } } }),
      del: async () => (await prisma.coupon.deleteMany({ where: { code: { in: DEMO_COUPON_CODES } } })).count,
    },
  ];

  for (const step of steps) {
    const n = await step.count();
    if (EXECUTE) {
      const deleted = await step.del();
      console.log(`deleted ${String(deleted).padStart(6)}  ${step.label}`);
    } else {
      console.log(`would delete ${String(n).padStart(6)}  ${step.label}`);
    }
  }

  // ── 4. demo seed files ──
  const files = KEEP_DEMO_FILES ? [] : demoFileList();
  if (EXECUTE) {
    for (const f of files) fs.rmSync(f, { force: true });
    console.log(`deleted ${String(files.length).padStart(6)}  demo seed image files`);
  } else {
    console.log(`would delete ${String(files.length).padStart(6)}  demo seed image files`);
  }

  // ── 5. flip demoMode off ──
  const setting = await prisma.setting.findUnique({ where: { key: 'store' } });
  const value = (setting?.value ?? {}) as Record<string, unknown>;
  if (EXECUTE) {
    if (setting) {
      await prisma.setting.update({ where: { key: 'store' }, data: { value: { ...value, demoMode: false } } });
      console.log('settings.demoMode → false');
    } else {
      console.log('no settings row found — demoMode not changed');
    }
  } else {
    console.log(`would set settings.demoMode → false (currently ${JSON.stringify(value.demoMode ?? null)})`);
  }

  console.log('──────────────────────────────────────────────────────────────');
  if (!EXECUTE) {
    console.log('Dry run complete. Re-run with --execute to apply.');
  } else {
    console.log('Cleanup complete. Verify the storefront, then import your real catalog.');
    console.log('Reminder: demo cleanup does NOT configure payments/supplier/email — see SETUP_CHECKLIST.md.');
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
