import { prisma } from '../db';
import { STOREFRONT_PRODUCT_WHERE } from './eligibility';

export interface CatalogPipelineCounts {
  products: {
    total: number;
    active: number;
    storefrontEligible: number;
    activeUnpriced: number;
    draft: number;
    archived: number;
  };
  supplierProducts: {
    total: number;
    active: number;
    inactive: number;
    mapped: number;
    unmapped: number;
    needsReview: number;
    rejected: number;
    importPublished: number;
    importDraft: number;
    importUnmapped: number;
  };
}

/**
 * Exact, read-only catalogue counts for the authenticated admin pipeline page.
 * Storefront eligibility deliberately shares the sitemap/query predicate:
 * ACTIVE + a positive stored selling price. Stock and category are not default
 * storefront filters; they are shown as availability/category facets instead.
 */
export async function getCatalogPipelineCounts(): Promise<CatalogPipelineCounts> {
  const [
    productStatuses,
    storefrontEligible,
    activeUnpriced,
    supplierProductTotal,
    mappedSupplierProducts,
    unmappedSupplierProducts,
    supplierProductStates,
    needsReview,
    rejected,
    importPublished,
    importDraft,
    importUnmapped,
  ] = await Promise.all([
    prisma.product.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.product.count({ where: STOREFRONT_PRODUCT_WHERE }),
    prisma.product.count({ where: { status: 'ACTIVE', sellingPrice: { lte: '0' } } }),
    prisma.supplierProduct.count(),
    prisma.supplierProduct.count({ where: { productId: { not: null } } }),
    prisma.supplierProduct.count({ where: { productId: null } }),
    prisma.supplierProduct.groupBy({ by: ['isActive'], _count: { _all: true } }),
    prisma.supplierProduct.count({
      where: { raw: { path: ['importState', 'status'], equals: 'NEEDS_REVIEW' } },
    }),
    prisma.supplierProduct.count({
      where: { raw: { path: ['importState', 'status'], equals: 'REJECTED' } },
    }),
    prisma.supplierProduct.count({
      where: { raw: { path: ['importState', 'status'], equals: 'PUBLISHED' } },
    }),
    prisma.supplierProduct.count({
      where: { raw: { path: ['importState', 'status'], equals: 'DRAFT' } },
    }),
    prisma.supplierProduct.count({
      where: { raw: { path: ['importState', 'status'], equals: 'UNMAPPED' } },
    }),
  ]);

  const productCount = (status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED') =>
    productStatuses.find((group) => group.status === status)?._count._all ?? 0;
  const supplierProductCount = (isActive: boolean) =>
    supplierProductStates.find((group) => group.isActive === isActive)?._count._all ?? 0;
  const active = productCount('ACTIVE');
  const draft = productCount('DRAFT');
  const archived = productCount('ARCHIVED');

  return {
    products: {
      total: active + draft + archived,
      active,
      storefrontEligible,
      activeUnpriced,
      draft,
      archived,
    },
    supplierProducts: {
      total: supplierProductTotal,
      active: supplierProductCount(true),
      inactive: supplierProductCount(false),
      mapped: mappedSupplierProducts,
      unmapped: unmappedSupplierProducts,
      needsReview,
      rejected,
      importPublished,
      importDraft,
      importUnmapped,
    },
  };
}
