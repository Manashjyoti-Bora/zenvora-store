import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { listStorefrontProducts } from '@/lib/catalog/storefront';
import { findSearchAlternatives, suggestSearch } from '@/lib/catalog/search';
import { cleanupTestData, createTestProduct, unique } from './fixtures';

/**
 * Search behaviour against the real database: multi-word matching, visibility
 * gating (drafts never leak), typeahead bounds and no-result alternatives that
 * only ever contain live catalogue rows.
 */
describe('catalogue search', () => {
  const marker = unique('zq').replace(/-/g, ''); // unique word so seed data can't collide
  let categoryId: string;
  let categorySlug: string;

  beforeAll(async () => {
    await cleanupTestData();
    categorySlug = `itest-cat-${marker}`;
    const cat = await prisma.category.create({
      data: { name: `Itest ${marker} Audio`, slug: categorySlug, isActive: true },
    });
    categoryId = cat.id;
    await createTestProduct({
      name: `${marker} Wireless Earbuds Pro`,
      brand: 'Sonic',
      categoryId,
      sellingPrice: '1999.00',
      stock: 5,
    });
    await createTestProduct({
      name: `${marker} Wired Earphones`,
      brand: 'Sonic',
      categoryId,
      sellingPrice: '499.00',
      stock: 5,
    });
    await createTestProduct({
      name: `${marker} Desk Lamp`,
      brand: 'Lumen',
      sellingPrice: '899.00',
      stock: 5,
    });
    await createTestProduct({
      name: `${marker} Draft Earbuds`,
      brand: 'Sonic',
      status: 'DRAFT',
      sellingPrice: '1499.00',
      stock: 5,
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.category.deleteMany({ where: { slug: { startsWith: 'itest-cat-' } } });
  });

  it('matches when every word appears somewhere, in any order and case', async () => {
    const r = await listStorefrontProducts({ q: `EARBUDS ${marker}`, perPage: 10 });
    expect(r.items.map((p) => p.name)).toEqual([`${marker} Wireless Earbuds Pro`]);
  });

  it('matches by brand + category name tokens, never returning DRAFT products', async () => {
    const r = await listStorefrontProducts({ q: `sonic ${marker}`, perPage: 10 });
    const names = r.items.map((p) => p.name).sort();
    expect(names).toEqual([`${marker} Wired Earphones`, `${marker} Wireless Earbuds Pro`]);
    const byCat = await listStorefrontProducts({ q: `${marker} audio`, perPage: 10 });
    expect(byCat.items.map((p) => p.name).sort()).toEqual(names);
  });

  it('returns nothing when one of the words matches no product (strict AND)', async () => {
    const r = await listStorefrontProducts({ q: `${marker} earbuds lamp`, perPage: 10 });
    expect(r.total).toBe(0);
  });

  it('combines text search with the in-stock filter instead of dropping either', async () => {
    const r = await listStorefrontProducts({ q: `${marker} lamp`, inStockOnly: true, perPage: 10 });
    expect(r.items.map((p) => p.name)).toEqual([`${marker} Desk Lamp`]);
    await prisma.product.updateMany({ where: { name: `${marker} Desk Lamp` }, data: { stock: 0 } });
    const r2 = await listStorefrontProducts({ q: `${marker} lamp`, inStockOnly: true, perPage: 10 });
    expect(r2.total).toBe(0);
    await prisma.product.updateMany({ where: { name: `${marker} Desk Lamp` }, data: { stock: 5 } });
  });

  it('typeahead: bounded, visible-only, includes matching categories; short queries hit no DB rows', async () => {
    const s = await suggestSearch(`${marker} ear`, { limit: 6 });
    expect(s.products.length).toBe(2);
    for (const p of s.products) {
      expect(p.name).not.toContain('Draft');
      expect(p.pricePaise).toBeGreaterThan(0);
      expect(p.slug).toMatch(/^itest-/);
    }
    const cat = await suggestSearch(`${marker} audio`);
    expect(cat.categories.map((c) => c.slug)).toContain(categorySlug);
    expect(cat.categories.find((c) => c.slug === categorySlug)?.productCount).toBe(2);

    const tiny = await suggestSearch('e');
    expect(tiny).toEqual({ query: 'e', products: [], categories: [] });
    const capped = await suggestSearch(marker, { limit: 1 });
    expect(capped.products).toHaveLength(1);
  });

  it('no-result alternatives: any-word matches + matched tokens + related categories, all real', async () => {
    const alt = await findSearchAlternatives(`${marker} earbuds lamp zzzznotaword`);
    expect(alt.matchedTokens.sort()).toEqual([marker, 'earbuds', 'lamp'].sort());
    const names = alt.partialMatches.map((p) => p.name);
    expect(names).toContain(`${marker} Wireless Earbuds Pro`);
    expect(names).toContain(`${marker} Desk Lamp`);
    expect(names.some((n) => n.includes('Draft'))).toBe(false);
    expect(alt.featured).toEqual([]); // only used when nothing else could be found

    const related = await findSearchAlternatives(`audio ${marker} nothingmatchesthis`);
    expect(related.categories.map((c) => c.slug)).toContain(categorySlug);
  });

  it('no-result alternatives fall back to currently visible products when nothing relates', async () => {
    const alt = await findSearchAlternatives('qzxv-nonexistent-9f8e7d');
    expect(alt.partialMatches).toEqual([]);
    expect(alt.matchedTokens).toEqual([]);
    expect(alt.categories).toEqual([]);
    // Whatever is featured must be ACTIVE & priced — never a draft.
    const ids = alt.featured.map((p) => p.id);
    if (ids.length > 0) {
      const rows = await prisma.product.findMany({ where: { id: { in: ids } } });
      expect(rows.every((r) => r.status === 'ACTIVE')).toBe(true);
    }
  });
});
