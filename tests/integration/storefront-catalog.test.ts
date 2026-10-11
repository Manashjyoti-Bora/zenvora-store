import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { listStorefrontProducts } from '@/lib/catalog/storefront';
import { createTestProduct, cleanupTestData, unique } from './fixtures';

describe('storefront product visibility and listing filters', () => {
  let productNamePrefix: string;
  let publishedInStockId: string;
  let publishedOutOfStockId: string;
  let draftId: string;
  let unpricedId: string;

  beforeAll(async () => {
    await cleanupTestData();
    productNamePrefix = `Itest Listing ${unique('catalog')}`;

    const available = await createTestProduct({
      name: `${productNamePrefix} available`,
      sellingPrice: '199.00',
      stock: 4,
    });
    publishedInStockId = available.id;

    const soldOut = await createTestProduct({
      name: `${productNamePrefix} sold out`,
      sellingPrice: '299.00',
      stock: 0,
    });
    publishedOutOfStockId = soldOut.id;

    const draft = await createTestProduct({
      name: `${productNamePrefix} draft`,
      sellingPrice: '399.00',
      stock: 5,
    });
    draftId = draft.id;
    await prisma.product.update({ where: { id: draft.id }, data: { status: 'DRAFT' } });

    const unpriced = await createTestProduct({
      name: `${productNamePrefix} unpriced`,
      sellingPrice: '0.00',
      stock: 5,
    });
    unpricedId = unpriced.id;
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it('shows active, positively priced products without requiring category or stock filters', async () => {
    const result = await listStorefrontProducts({ q: productNamePrefix, perPage: 48 });
    const ids = result.items.map((item) => item.id);

    expect(result.total).toBe(2);
    expect(ids).toContain(publishedInStockId);
    expect(ids).toContain(publishedOutOfStockId);
    expect(ids).not.toContain(draftId);
    expect(ids).not.toContain(unpricedId);
  });

  it('applies stock filtering without losing the search predicate', async () => {
    const result = await listStorefrontProducts({
      q: productNamePrefix,
      inStockOnly: true,
      perPage: 48,
    });
    const ids = result.items.map((item) => item.id);

    expect(result.total).toBe(1);
    expect(ids).toContain(publishedInStockId);
    expect(ids).not.toContain(publishedOutOfStockId);
  });

  it('keeps sorting and page totals consistent for the published result set', async () => {
    const pageOne = await listStorefrontProducts({
      q: productNamePrefix,
      sort: 'price-asc',
      perPage: 1,
      page: 1,
    });
    const pageTwo = await listStorefrontProducts({
      q: productNamePrefix,
      sort: 'price-asc',
      perPage: 1,
      page: 2,
    });

    expect(pageOne.total).toBe(2);
    expect(pageOne.totalPages).toBe(2);
    expect(pageOne.items).toHaveLength(1);
    expect(pageTwo.items).toHaveLength(1);
    expect(pageOne.items[0].pricePaise).toBeLessThan(pageTwo.items[0].pricePaise);
    expect(pageOne.items[0].id).not.toBe(pageTwo.items[0].id);
  });
});
