import type { Metadata } from 'next';
import Link from 'next/link';
import { getSettings } from '@/lib/settings';
import { env } from '@/lib/env';
import { Alert } from '@/components/ui/feedback';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return {
    title: 'About us',
    description: `Learn about ${settings.storeName} — how we source products, price them transparently and deliver across India.`,
    alternates: { canonical: '/about' },
    openGraph: { title: `About ${settings.storeName}`, url: `${env.APP_URL}/about` },
  };
}

export default async function AboutPage() {
  const settings = await getSettings();
  const b = settings.business;

  return (
    <div className="container-store max-w-3xl py-8 sm:py-12">
      <h1>About {settings.storeName}</h1>

      <div className="mt-6 space-y-6 text-sm leading-relaxed text-gray-700 sm:text-base">
        <section aria-labelledby="who-we-are">
          <h2 id="who-we-are">Who we are</h2>
          <p className="mt-2">
            {settings.storeName} is an online store bringing carefully selected products to
            customers across India. We work directly with verified suppliers and fulfilment
            partners, which lets us keep prices transparent and quality consistent.
            {settings.storeTagline ? ` ${settings.storeTagline}.` : ''}
          </p>
        </section>

        <section aria-labelledby="how-it-works">
          <h2 id="how-it-works">How our store works</h2>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li>
              <strong>Curated catalog:</strong> every product listed here is sourced through a
              supplier we have vetted. Product details, prices and availability are kept up to date.
            </li>
            <li>
              <strong>Transparent pricing:</strong> the price you see in ₹ is the price you pay
              (inclusive of applicable taxes). Shipping is shown clearly at checkout
              {settings.shipping.freeAbovePaise > 0
                ? `, and orders above ₹${(settings.shipping.freeAbovePaise / 100).toLocaleString('en-IN')} ship free`
                : ''}
              .
            </li>
            <li>
              <strong>Automated fulfilment:</strong> when you pay, your order is confirmed instantly
              and routed to our fulfilment network. You receive tracking updates by email and can
              follow your shipment any time on our{' '}
              <Link href="/track" className="link-primary">
                tracking page
              </Link>
              .
            </li>
            <li>
              <strong>Real support:</strong> questions about an order are answered by our team —
              reach us at{' '}
              <a href={`mailto:${settings.supportEmail}`} className="link-primary">
                {settings.supportEmail}
              </a>
              {settings.supportPhone ? ` or ${settings.supportPhone}` : ''}.
            </li>
          </ul>
        </section>

        <section aria-labelledby="our-commitments">
          <h2 id="our-commitments">Our commitments</h2>
          <ul className="mt-2 list-disc space-y-2 pl-5">
            <li>No hidden charges — taxes and shipping are disclosed before you pay.</li>
            <li>
              {settings.policies.returnWindowDays > 0
                ? `Returns accepted within ${settings.policies.returnWindowDays} days of delivery, per our returns policy.`
                : 'Our returns policy explains exactly what can be returned and how.'}
            </li>
            <li>
              Your payment details are processed by licensed payment providers — we never see or
              store card numbers, CVVs or UPI PINs.
            </li>
            <li>
              Your personal data is handled as described in our{' '}
              <Link href="/policies/privacy" className="link-primary">
                privacy policy
              </Link>
              .
            </li>
          </ul>
        </section>

        {(b.legalName || b.gstin || b.addressLine) && (
          <section aria-labelledby="registered-business">
            <h2 id="registered-business">Registered business</h2>
            <address className="mt-2 not-italic">
              {b.legalName && <p className="font-medium text-gray-900">{b.legalName}</p>}
              {(b.addressLine || b.city) && (
                <p className="mt-1">
                  {[b.addressLine, b.city, b.state, b.postalCode].filter(Boolean).join(', ')}
                </p>
              )}
              {b.gstin && <p className="mt-1">GSTIN: {b.gstin}</p>}
            </address>
          </section>
        )}

        {settings.demoMode && (
          <Alert tone="warning" title="Demo mode is currently on">
            The catalog and orders in this deployment are demonstration data for evaluating the
            platform. Business details above may be placeholders until the store owner completes
            setup. See the{' '}
            <Link href="/faq#demo-mode" className="link-primary">
              FAQ
            </Link>{' '}
            for details.
          </Alert>
        )}
      </div>
    </div>
  );
}
