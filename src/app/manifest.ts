import type { MetadataRoute } from 'next';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

/**
 * Web app manifest — store name/tagline stay dynamic (Admin → Settings) while
 * colours and icons follow the Zenvora design tokens. Served at
 * /manifest.webmanifest and linked automatically by Next.js.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const settings = await getSettings();
  return {
    name: settings.storeName,
    short_name: settings.storeName,
    description: settings.storeTagline || 'Quality products, delivered to you.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#F8F7F2',
    theme_color: '#174B3A',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
    ],
  };
}
