import './env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';
import { formatINR, toPaise } from '@/lib/money';

import { HttpAgent, waitForServer } from './http';

/**
 * E2E — public storefront.
 * Runs against `npm run dev` on E2E_BASE_URL with the seeded development DB.
 * Nothing is mocked: pages are fetched over HTTP exactly like a browser would.
 */

const agent = new HttpAgent();

interface CatalogRow {
  slug: string;
  name: string;
  minPrice: number | null;
}

let product: CatalogRow;
let categorySlug: string | null = null;

beforeAll(async () => {
  await waitForServer();
  const p = await prisma.product.findFirst({
    where: { status: 'ACTIVE' },
    include: { category: true, variants: { where: { isActive: true } } },
  });
  if (!p) throw new Error('E2E requires seeded products — run `npm run db:seed`');
  const variantPrices = p.variants.filter((v) => v.sellingPrice !== null).map((v) => toPaise(v.sellingPrice!));
  product = {
    slug: p.slug,
    name: p.name,
    minPrice: variantPrices.length > 0 ? Math.min(...variantPrices) : toPaise(p.sellingPrice),
  };
  categorySlug = p.category?.slug ?? null;
  // Prime the cookie jar: the middleware issues resellix_csrf on every response.
  await agent.get('/api/health');
}, 180_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('storefront pages (real HTTP, real dev DB)', () => {
  it('serves the home page with viewport meta and store identity', async () => {
    const res = await agent.get('/');
    expect(res.status).toBe(200);
    expect(res.body).toContain('width=device-width');
    expect(res.body).toContain(process.env.APP_NAME ?? 'Resellix');
  });

  it('serves /shop and lists a real seeded product', async () => {
    const res = await agent.get('/shop');
    expect(res.status).toBe(200);
    expect(res.body).toContain(product.name);
  });

  it('serves category listing pages when categories exist', async () => {
    if (!categorySlug) return;
    const res = await agent.get(`/shop?category=${categorySlug}`);
    expect(res.status).toBe(200);
  });

  it('serves the product detail page with formatted INR price', async () => {
    const res = await agent.get(`/products/${product.slug}`);
    expect(res.status).toBe(200);
    expect(res.body).toContain(product.name);
    if (product.minPrice !== null) {
      // formatINR uses ₹ + Indian digit grouping; HTML may entity-escape ₹.
      const formatted = formatINR(product.minPrice);
      const digitsOnly = formatted.replace(/[^\d.,]/g, '');
      expect(res.body).toContain(digitsOnly);
    }
  });

  it('returns a real 404 for an unknown product slug (no soft-404, no fake content)', async () => {
    const res = await agent.get('/products/definitely-not-a-real-product-xyz');
    expect(res.status).toBe(404);
    expect(res.body.toLowerCase()).toContain('not found');
  });

  it('returns a real 404 for an unknown category slug', async () => {
    const res = await agent.get('/categories/no-such-category-xyz');
    expect(res.status).toBe(404);
  });

  it('serves the order tracking page', async () => {
    const res = await agent.get('/track');
    expect(res.status).toBe(200);
  });

  it('serves the cart page', async () => {
    const res = await agent.get('/cart');
    expect(res.status).toBe(200);
  });
});

describe('API + SEO endpoints', () => {
  it('GET /api/health reports database connectivity honestly', async () => {
    const res = await agent.get('/api/health');
    expect(res.status).toBe(200);
    const body = res.json<{ status?: string; checks?: { database?: boolean } }>();
    expect(body?.status).toBe('ok');
    expect(body?.checks?.database).toBe(true);
  });

  it('GET /sitemap.xml includes the product URL', async () => {
    const res = await agent.get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.body).toContain(`/products/${product.slug}`);
  });

  it('GET /robots.txt exists and protects admin paths', async () => {
    const res = await agent.get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.body).toMatch(/Disallow:\s*\/admin/i);
  });
});

describe('security headers (next.config headers())', () => {
  it('sets hardening headers on storefront responses', async () => {
    const res = await agent.get('/shop');
    expect(res.headers.get('x-content-type-options')?.toLowerCase()).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBeTruthy();
    expect(res.headers.get('referrer-policy')).toBeTruthy();
  });
});
