import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

export default function robots(): MetadataRoute.Robots {
  const base = env.APP_URL.replace(/\/$/, '');
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/account', '/admin', '/checkout', '/auth/', '/order/'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
