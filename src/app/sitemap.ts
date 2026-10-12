import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';
import { prisma } from '@/lib/db';
import { isSitemapEligible, SITEMAP_PRODUCT_WHERE } from '@/lib/catalog/eligibility';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.APP_URL.replace(/\/$/, '');

  // Static routes intentionally carry NO lastModified: stamping "now" on every
  // regeneration would claim the page changed when it did not. Product and
  // category entries below use their real updatedAt timestamps.
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/shop`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/track`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/about`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/contact`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/faq`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/policies/privacy`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/policies/terms`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/policies/shipping`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/policies/returns`, changeFrequency: 'yearly', priority: 0.3 },
  ];

  const [categories, products] = await Promise.all([
    // Only categories that actually list purchasable products: an empty
    // category page is thin content and must not be advertised to crawlers.
    // Parent categories also render their children's products (see the
    // storefront query), so children's eligible counts roll up here.
    prisma.category.findMany({
      where: { isActive: true },
      select: {
        slug: true,
        updatedAt: true,
        _count: { select: { products: { where: SITEMAP_PRODUCT_WHERE } } },
        children: {
          where: { isActive: true },
          select: { _count: { select: { products: { where: SITEMAP_PRODUCT_WHERE } } } },
        },
      },
    }),
    // Only published products with a real price: an unpriced/unpublished page
    // must not be advertised to crawlers. Same predicate as the query (shared
    // module) so the rule cannot drift between the two.
    prisma.product.findMany({
      where: SITEMAP_PRODUCT_WHERE,
      select: { slug: true, updatedAt: true, status: true, sellingPrice: true },
      take: 5000,
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  return [
    ...staticRoutes,
    ...categories
      .filter(
        (c) =>
          c._count.products + c.children.reduce((sum, child) => sum + child._count.products, 0) > 0
      )
      .map((c) => ({
        url: `${base}/categories/${c.slug}`,
        lastModified: c.updatedAt,
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      })),
    ...products
      .filter((p) =>
        isSitemapEligible({
          status: p.status,
          pricePaise: Math.round(Number(p.sellingPrice) * 100),
        })
      )
      .map((p) => ({
        url: `${base}/products/${p.slug}`,
        lastModified: p.updatedAt,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      })),
  ];
}
