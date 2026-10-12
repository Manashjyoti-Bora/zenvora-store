import { MetadataRoute } from 'next';
import { getSettings } from '@/lib/settings';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const settings = await getSettings();

  return {
    name: settings.storeName,
    short_name: settings.storeName,
    description: settings.storeTagline || 'Quality products, delivered to you',
    start_url: '/',
    display: 'standalone',
    background_color: '#F8F7F2',
    theme_color: '#174B3A',
    icons: [
      {
        src: '/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}