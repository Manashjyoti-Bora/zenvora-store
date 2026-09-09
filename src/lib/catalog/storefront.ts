import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { toPaise, paiseToDecimalString } from '../money';
import { clampInt } from '../money';

/**
 * Storefront catalog queries - read-only, ACTIVE products only.
 * Admin listing lives in catalog/products.ts.
 */

export type StoreSort = 'featured' | 'newest' | 'price-asc' | 'price-desc' | 'popular';

export interface ProductCardData {
  id: string;
  slug: string;
  name: string;
  imageUrls: string[];
  imageAlt: string | null;
  pricePaise: number;
  compareAtPricePaise: number | null;
  stock: number;
  lowStockThreshold: number;
  hasVariants: boolean;
  categoryName: string | null;
}

const cardInclude = {
  images: {
    orderBy: [
      { isPrimary: 'desc' },
      { position: 'asc' },
    ] as Prisma.ProductImageOrderByWithRelationInput[],
    select: { url: true, alt: true },
  },
  category: { select: { name: true } },
  variants: { where: { isActive: true }, select: { sellingPrice: true, stock: true } },
} satisfies Prisma.ProductInclude;

type CardProduct = Prisma.ProductGetPayload<{ include: typeof cardInclude }>;

export function toCardData(p: CardProduct): ProductCardData {
  const variantPrices = p.variants
    .filter((v) => v.sellingPrice != null)
    .map((v) => toPaise(v.sellingPrice!));
  const pricePaise =
    variantPrices.length > 0
      ? Math.min(...variantPrices, toPaise(p.sellingPrice))
      : toPaise(p.sellingPrice);
  const stock = p.hasVariants ? p.variants.reduce((a, v) => a + v.stock, 0) : p.stock;
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    imageUrls: p.images.map((i) => i.url),
    imageAlt: p.images[0]?.alt ?? null,
    pricePaise,
    compareAtPricePaise: p.compareAtPrice != null ? toPaise(p.compareAtPrice) : null,
    stock,
    lowStockThreshold: p.lowStockThreshold,
    hasVariants: p.hasVariants,
    categoryName: p.category?.name ?? null,
  };
}

const orderByFor: Record<StoreSort, Prisma.ProductOrderByWithRelationInput[]> = {
  featured: [{ sortOrder: 'desc' }, { createdAt: 'desc' }],
  newest: [{ createdAt: 'desc' }],
  'price-asc': [{ sellingPrice: 'asc' }],
  'price-desc': [{ sellingPrice: 'desc' }],
  popular: [{ viewCount: 'desc' }, { createdAt: 'desc' }],
};

export interface ListParams {
  q?: string;
  categorySlug?: string;
  sort?: StoreSort;
  page?: number;
  perPage?: number;
  minPricePaise?: number | null;
  maxPricePaise?: number | null;
  inStockOnly?: boolean;
}

export interface ListResult {
  items: ProductCardData[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export async function listStorefrontProducts(params: ListParams): Promise<ListResult> {
  const page = Math.max(1, params.page ?? 1);
  const perPage = clampInt(params.perPage ?? 12, 1, 48);

  const where: Prisma.ProductWhereInput = { status: 'ACTIVE' };
  if (params.categorySlug) {
    where.category = { slug: params.categorySlug, isActive: true };
  }
  if (params.q && params.q.trim()) {
    const term = params.q.trim();
    where.OR = [
      { name: { contains: term, mode: 'insensitive' } },
      { slug: { contains: term.toLowerCase(), mode: 'insensitive' } },
      { brand: { contains: term, mode: 'insensitive' } },
      { sku: { contains: term, mode: 'insensitive' } },
      { shortDescription: { contains: term, mode: 'insensitive' } },
      { description: { contains: term, mode: 'insensitive' } },
    ];
  }
  if (params.minPricePaise != null || params.maxPricePaise != null) {
    where.sellingPrice = {};
    if (params.minPricePaise != null)
      where.sellingPrice.gte = paiseToDecimalString(params.minPricePaise);
    if (params.maxPricePaise != null)
      where.sellingPrice.lte = paiseToDecimalString(params.maxPricePaise);
  }
  if (params.inStockOnly) {
    // Variant products: at least one active variant in stock; local: stock > 0.
    where.OR = params.q?.trim()
      ? // combine text OR with stock OR would clash; keep stock filter simple here
        [{ stock: { gt: 0 } }, { variants: { some: { isActive: true, stock: { gt: 0 } } } }]
      : [{ stock: { gt: 0 } }, { variants: { some: { isActive: true, stock: { gt: 0 } } } }];
    if (params.q?.trim()) {
      // both q and inStock: wrap q conditions and stock conditions with AND
      const term = params.q.trim();
      const qOr = where.OR;
      delete where.OR;
      (where as Prisma.ProductWhereInput).AND = [
        {
          OR: qOr as Prisma.ProductWhereInput[],
        },
        {
          OR: [{ stock: { gt: 0 } }, { variants: { some: { isActive: true, stock: { gt: 0 } } } }],
        },
      ];
      void term;
    }
  }

  const sort = params.sort ?? 'featured';
  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: cardInclude,
      orderBy: orderByFor[sort],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.product.count({ where }),
  ]);

  return {
    items: rows.map(toCardData),
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

// ---------------------------------------------------------------------------
// Product detail
// ---------------------------------------------------------------------------

const detailInclude = {
  category: { select: { id: true, name: true, slug: true } },
  images: {
    orderBy: [
      { isPrimary: 'desc' },
      { position: 'asc' },
    ] as Prisma.ProductImageOrderByWithRelationInput[],
  },
  variants: {
    orderBy: [
      { sortOrder: 'asc' },
      { createdAt: 'asc' },
    ] as Prisma.ProductVariantOrderByWithRelationInput[],
    where: { isActive: true },
  },
} satisfies Prisma.ProductInclude;

export type StorefrontProduct = Prisma.ProductGetPayload<{ include: typeof detailInclude }>;

export async function getStorefrontProduct(slug: string): Promise<StorefrontProduct | null> {
  const product = await prisma.product.findFirst({
    where: { slug, status: 'ACTIVE' },
    include: detailInclude,
  });
  if (!product) return null;
  // Best-effort popularity counter; never fail the request over it.
  prisma.product
    .update({ where: { id: product.id }, data: { viewCount: { increment: 1 } } })
    .catch(() => undefined);
  return product;
}

export async function getRelatedProducts(
  product: StorefrontProduct,
  limit = 4
): Promise<ProductCardData[]> {
  const where: Prisma.ProductWhereInput = {
    status: 'ACTIVE',
    id: { not: product.id },
    ...(product.categoryId ? { categoryId: product.categoryId } : {}),
  };
  let rows = await prisma.product.findMany({
    where,
    include: cardInclude,
    take: limit,
    orderBy: [{ sortOrder: 'desc' }, { createdAt: 'desc' }],
  });
  if (rows.length < limit) {
    const extra = await prisma.product.findMany({
      where: { status: 'ACTIVE', id: { notIn: [product.id, ...rows.map((r) => r.id)] } },
      include: cardInclude,
      take: limit - rows.length,
      orderBy: [{ createdAt: 'desc' }],
    });
    rows = [...rows, ...extra];
  }
  return rows.map(toCardData);
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export interface CategoryTile {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  productCount: number;
}

export async function listActiveCategories(): Promise<CategoryTile[]> {
  const cats = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { products: { where: { status: 'ACTIVE' } } } } },
  });
  return cats.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    productCount: c._count.products,
  }));
}

export async function getCategoryBySlug(slug: string) {
  return prisma.category.findFirst({ where: { slug, isActive: true } });
}

/** Home page sections. */
export async function getFeaturedProducts(limit = 8): Promise<ProductCardData[]> {
  const rows = await prisma.product.findMany({
    where: { status: 'ACTIVE' },
    include: cardInclude,
    orderBy: [{ sortOrder: 'desc' }, { viewCount: 'desc' }],
    take: limit,
  });
  return rows.map(toCardData);
}

export async function getNewArrivals(limit = 8): Promise<ProductCardData[]> {
  const rows = await prisma.product.findMany({
    where: { status: 'ACTIVE' },
    include: cardInclude,
    orderBy: [{ createdAt: 'desc' }],
    take: limit,
  });
  return rows.map(toCardData);
}

export function parseSort(value: string | undefined): StoreSort {
  const allowed: StoreSort[] = ['featured', 'newest', 'price-asc', 'price-desc', 'popular'];
  return (allowed as string[]).includes(value ?? '') ? (value as StoreSort) : 'featured';
}

export function parsePriceBound(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return toPaise(n);
}
