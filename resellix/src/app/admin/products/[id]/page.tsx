import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { toPaise } from '@/lib/money';
import { ProductForm, type ProductFormInitial } from '@/components/admin/product-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Edit product — Admin', robots: { index: false } };

type Ctx = { params: Promise<{ id: string }> };

export default async function EditProductPage({ params }: Ctx) {
  const { id } = await params;
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      images: { orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }] },
      variants: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
    },
  });
  if (!product) notFound();

  const [categories, suppliers] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.supplier.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, type: true },
    }),
  ]);

  const str = (v: unknown): string => (v == null ? '' : String(v));

  const initial: ProductFormInitial = {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    shortDescription: product.shortDescription ?? '',
    sku: product.sku ?? '',
    brand: product.brand ?? '',
    status: product.status,
    categoryId: product.categoryId ?? '',
    supplierId: product.supplierId ?? '',
    supplierSku: product.supplierSku ?? '',
    stockMode: product.stockMode,
    supplierCost: str(product.supplierCost),
    supplierShippingCost: str(product.supplierShippingCost),
    otherCost: str(product.otherCost),
    pricingMode: product.pricingMode,
    fixedPrice: str(product.fixedPrice),
    fixedMargin: str(product.fixedMargin),
    percentMarkup: str(product.percentMarkup),
    minProfit: str(product.minProfit),
    roundingRule: product.roundingRule,
    compareAtPrice: str(product.compareAtPrice),
    taxRatePercent: str(product.taxRatePercent),
    weightGrams: str(product.weightGrams),
    lengthCm: str(product.lengthCm),
    widthCm: str(product.widthCm),
    heightCm: str(product.heightCm),
    seoTitle: product.seoTitle ?? '',
    seoDescription: product.seoDescription ?? '',
    stock: product.stock,
    sellingPricePaise: toPaise(product.sellingPrice),
    images: product.images.map((i) => ({ id: i.id, url: i.url, alt: i.alt ?? '' })),
    variants: product.variants.map((v) => ({
      id: v.id,
      name: v.name,
      sku: v.sku ?? '',
      size: v.size ?? '',
      color: v.color ?? '',
      supplierCost: str(v.supplierCost),
      sellingPrice: str(v.sellingPrice),
      compareAtPrice: str(v.compareAtPrice),
      taxRatePercent: str(v.taxRatePercent),
      stock: v.stock,
      isActive: v.isActive,
    })),
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="line-clamp-1">Edit: {product.name}</h1>
          <p className="mt-1 text-sm text-gray-500">
            Last updated{' '}
            {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(
              product.updatedAt
            )}
            {' · '}views: {product.viewCount}
          </p>
        </div>
        <Link href="/admin/products" className="text-sm font-medium text-brand-700 hover:underline">
          ← Back to products
        </Link>
      </header>
      <ProductForm initial={initial} categories={categories} suppliers={suppliers} />
    </div>
  );
}
