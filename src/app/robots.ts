import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

export default function robots(): MetadataRoute.Robots {
  const base = env.APP_URL.replace(/\/$/, '');
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Private surfaces. NOTE: /cart, /wishlist and /search are
        // intentionally NOT disallowed — they carry `noindex` meta tags,
        // which crawlers can only honour if they are allowed to fetch the
        // page. A robots disallow is not access control: every route above
        // is additionally protected by server-side auth where required.
        disallow: ['/api/', '/account', '/admin', '/checkout', '/auth/', '/order/'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
