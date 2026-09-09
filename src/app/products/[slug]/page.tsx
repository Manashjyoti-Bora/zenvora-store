import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { env } from '@/lib/env';
import { getSettings } from '@/lib/settings';
import { getStorefrontProduct, getRelatedProducts } from '@/lib/catalog/storefront';
import { toPaise, formatINR } from '@/lib/money';
import { ProductGallery } from '@/components/store/product-gallery';
import { ProductBuyBox, type BuyBoxVariant } from '@/components/store/product-buy-box';
import { ProductGrid } from '@/components/store/product-grid';
import { Breadcrumbs } from '@/components/store/breadcrumbs';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Ctx): Promise<Metadata> {
  const { slug } = await params;
  const product = await getStorefrontProduct(slug);
  // notFound() must be thrown from generateMetadata too: when metadata resolves
  // successfully, Next.js can otherwise answer 200 even though the page body
  // renders the not-found UI (soft 404 — bad for SEO and correctness).
  if (!product) notFound();
  const title = product.seoTitle || product.name;
  const description =
    product.seoDescription || product.shortDescription || product.description.slice(0, 155);
  return {
    title,
    description,
    alternates: { canonical: `/products/${product.slug}` },
    openGraph: {
      title,
      description,
      type: 'website',
      url: `${env.APP_URL}/products/${product.slug}`,
      images: product.images.slice(0, 1).map((i) => ({
        url: i.url.startsWith('http') ? i.url : `${env.APP_URL}${i.url}`,
        alt: i.alt || product.name,
      })),
    },
  };
}

export default async function ProductPage({ params }: Ctx) {
  const { slug } = await params;
  const product = await getStorefrontProduct(slug);
  if (!product) notFound();

  const [settings, related] = await Promise.all([getSettings(), getRelatedProducts(product, 4)]);

  const activeVariants = product.variants.filter((v) => v.isActive);
  const basePricePaise = toPaise(product.sellingPrice);
  const baseStock = product.hasVariants
    ? activeVariants.reduce((a, v) => a + v.stock, 0)
    : product.stock;

  const buyBoxVariants: BuyBoxVariant[] = product.hasVariants
    ? activeVariants.map((v) => ({
        id: v.id,
        label: v.name,
        pricePaise: v.sellingPrice != null ? toPaise(v.sellingPrice) : basePricePaise,
        compareAtPricePaise: v.compareAtPrice != null ? toPaise(v.compareAtPrice) : null,
        stock: v.stock,
        isActive: v.isActive,
      }))
    : [];

  const images = product.images.map((i) => ({ url: i.url, alt: i.alt }));

  // Structured data (schema.org Product). Prices mirror what is displayed.
  const variantPrices = buyBoxVariants.map((v) => v.pricePaise / 100);
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.shortDescription || product.description.slice(0, 300),
    sku: product.sku ?? undefined,
    brand: product.brand ? { '@type': 'Brand', name: product.brand } : undefined,
    image: images.map((i) => (i.url.startsWith('http') ? i.url : `${env.APP_URL}${i.url}`)),
    offers:
      variantPrices.length > 1
        ? {
            '@type': 'AggregateOffer',
            priceCurrency: 'INR',
            lowPrice: Math.min(...variantPrices, basePricePaise / 100),
            highPrice: Math.max(...variantPrices),
            offerCount: buyBoxVariants.length,
            availability:
              baseStock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
            url: `${env.APP_URL}/products/${product.slug}`,
          }
        : {
            '@type': 'Offer',
            priceCurrency: 'INR',
            price: basePricePaise / 100,
            availability:
              baseStock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
            url: `${env.APP_URL}/products/${product.slug}`,
          },
  };

  return (
    <div className="container-store py-6 sm:py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Breadcrumbs
        items={[
          { label: 'Home', href: '/' },
          { label: 'Shop', href: '/shop' },
          ...(product.category
            ? [{ label: product.category.name, href: `/categories/${product.category.slug}` }]
            : []),
          { label: product.name },
        ]}
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <ProductGallery images={images} name={product.name} />

        <div className="space-y-5">
          <div>
            {product.category && (
              <Link href={`/categories/${product.category.slug}`}>
                <Badge tone="neutral">{product.category.name}</Badge>
              </Link>
            )}
            <h1 className="mt-2 text-2xl sm:text-3xl">{product.name}</h1>
            {product.brand && <p className="mt-1 text-sm text-gray-500">Brand: {product.brand}</p>}
            {product.shortDescription && (
              <p className="mt-2 text-sm leading-relaxed text-gray-600">
                {product.shortDescription}
              </p>
            )}
          </div>

          <ProductBuyBox
            productId={product.id}
            basePricePaise={basePricePaise}
            baseCompareAtPaise={
              product.compareAtPrice != null ? toPaise(product.compareAtPrice) : null
            }
            baseStock={baseStock}
            variants={buyBoxVariants}
            lowStockThreshold={product.lowStockThreshold}
          />

          <dl className="grid grid-cols-1 gap-2 rounded-xl border border-gray-200 bg-white p-4 text-sm sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <dt className="text-gray-500">🚚 Delivery estimate</dt>
              <dd className="font-medium text-gray-900">
                {settings.shipping.estimatedDaysMin}–{settings.shipping.estimatedDaysMax} days
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-gray-500">↩️ Returns</dt>
              <dd className="font-medium text-gray-900">
                {settings.policies.returnWindowDays > 0
                  ? `${settings.policies.returnWindowDays} days`
                  : 'See policy'}{' '}
                <Link href="/policies/returns" className="link-primary text-xs">
                  policy
                </Link>
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-gray-500">💳 Payment</dt>
              <dd className="font-medium text-gray-900">
                Online{settings.shipping.codEnabled ? ' + COD' : ''}
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-gray-500">🧾 Prices</dt>
              <dd className="font-medium text-gray-900">
                {settings.tax.pricesIncludeTax ? 'Inclusive of taxes' : 'Taxes added at checkout'}
              </dd>
            </div>
          </dl>

          {product.sku && <p className="text-xs text-gray-400">SKU: {product.sku}</p>}
        </div>
      </div>

      {/* Description & details */}
      <section
        className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-3"
        aria-labelledby="product-details"
      >
        <div className="lg:col-span-2">
          <h2 id="product-details">Product details</h2>
          <div className="mt-3 whitespace-pre-line text-sm leading-relaxed text-gray-700">
            {product.description}
          </div>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Specifications</h2>
          <dl className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white text-sm">
            {[
              ['Brand', product.brand],
              ['SKU', product.sku],
              ['Weight', product.weightGrams ? `${product.weightGrams} g` : null],
              [
                'Dimensions',
                product.lengthCm && product.widthCm && product.heightCm
                  ? `${product.lengthCm} × ${product.widthCm} × ${product.heightCm} cm`
                  : null,
              ],
              [
                'Tax rate',
                Number(product.taxRatePercent) > 0
                  ? `${Number(product.taxRatePercent)}% (included)`
                  : null,
              ],
              [
                'Options',
                product.hasVariants ? `${activeVariants.length} available` : 'Single variant',
              ],
            ]
              .filter((row): row is [string, string] => Boolean(row[1]))
              .map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
                  <dt className="text-gray-500">{k}</dt>
                  <dd className="text-right font-medium text-gray-900">{v}</dd>
                </div>
              ))}
            {![product.brand, product.sku, product.weightGrams].some(Boolean) && (
              <p className="px-4 py-3 text-xs text-gray-400">
                Specifications will be listed here once provided by the seller.
              </p>
            )}
          </dl>
        </div>
      </section>

      {related.length > 0 && (
        <section className="mt-12" aria-labelledby="related-products">
          <h2 id="related-products">You may also like</h2>
          <div className="mt-4">
            <ProductGrid products={related} />
          </div>
        </section>
      )}

      <p className="mt-10 text-center text-xs text-gray-400">
        Questions about this product?{' '}
        <Link
          href={`/contact?subject=${encodeURIComponent(`Question about ${product.name}`)}`}
          className="link-primary"
        >
          Contact our support team
        </Link>{' '}
        — we usually reply within 1 business day.
      </p>
      <p className="mt-1 text-center text-xs tabular-nums text-gray-400">
        Current price: {formatINR(basePricePaise)}
      </p>
    </div>
  );
}
