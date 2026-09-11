import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { getSettings } from '@/lib/settings';
import { env } from '@/lib/env';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { DemoBanner } from '@/components/layout/demo-banner';
import { CookieConsent } from '@/components/layout/cookie-consent';
import { Toaster } from '@/components/ui/toaster';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return {
    metadataBase: new URL(env.APP_URL),
    title: {
      default: `${settings.storeName} - ${settings.storeTagline || 'Quality products, delivered to you'}`,
      template: `%s | ${settings.storeName}`,
    },
    description:
      settings.storeTagline ||
      `${settings.storeName} - shop quality products online with fast delivery across India.`,
    applicationName: settings.storeName,
    openGraph: {
      type: 'website',
      siteName: settings.storeName,
      locale: 'en_IN',
      url: env.APP_URL,
    },
    robots: { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#20573c',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSettings();
  const h = await headers();
  const isAdminArea = (h.get('x-pathname') ?? '').startsWith('/admin');

  return (
    <html lang="en">
      <body className="no-page-overflow flex min-h-screen flex-col">
        {/* No-JS fallback: scroll-reveal elements must never stay hidden without script. */}
        <noscript>
          <style>{`.reveal{opacity:1 !important;transform:none !important;}`}</style>
        </noscript>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[80] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-brand-700 focus:shadow-lg"
        >
          Skip to main content
        </a>
        {isAdminArea ? (
          <>
            <main id="main-content" className="flex-1">
              {children}
            </main>
            <Toaster />
          </>
        ) : (
          <>
            <DemoBanner demoMode={settings.demoMode} />
            {settings.announcement?.enabled && settings.announcement.text && (
              <div className="bg-ink-950 px-4 py-2 text-center text-xs font-medium tracking-wide text-cream-100">
                <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-brass-300 align-middle" aria-hidden="true" />
                {settings.announcement.text}
              </div>
            )}
            <Header />
            <main id="main-content" className="flex-1">
              {children}
            </main>
            <Footer />
            <CookieConsent storeName={settings.storeName} />
            <Toaster />
          </>
        )}
      </body>
    </html>
  );
}
