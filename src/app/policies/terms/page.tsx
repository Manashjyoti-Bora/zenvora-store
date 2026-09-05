import type { Metadata } from 'next';
import Link from 'next/link';
import { getSettings } from '@/lib/settings';
import { env } from '@/lib/env';
import { PolicyView } from '@/components/policies/policy-view';
import { formatINR } from '@/lib/money';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return {
    title: 'Terms & Conditions',
    description: `The terms governing use of ${settings.storeName} and purchases made on it.`,
    alternates: { canonical: '/policies/terms' },
    openGraph: {
      title: `Terms & Conditions | ${settings.storeName}`,
      url: `${env.APP_URL}/policies/terms`,
    },
  };
}

const LAST_UPDATED = '2026-09-05';

export default async function TermsPage() {
  const settings = await getSettings();

  return (
    <PolicyView
      title="Terms & Conditions"
      lastUpdated={LAST_UPDATED}
      settings={settings}
      sections={[
        {
          heading: 'Agreement',
          body: (
            <p>
              By browsing or purchasing on {settings.storeName} you agree to these terms. If you do
              not agree, please do not use the store. These terms apply alongside our{' '}
              <Link href="/policies/privacy" className="link-primary">
                Privacy Policy
              </Link>
              ,{' '}
              <Link href="/policies/shipping" className="link-primary">
                Shipping Policy
              </Link>{' '}
              and{' '}
              <Link href="/policies/returns" className="link-primary">
                Returns &amp; Refunds Policy
              </Link>
              .
            </p>
          ),
        },
        {
          heading: 'Accounts',
          body: (
            <ul className="list-disc space-y-1 pl-5">
              <li>
                You must provide accurate information and keep your login credentials confidential.
              </li>
              <li>
                You are responsible for activity under your account; notify us immediately of any
                unauthorised use.
              </li>
              <li>
                We may suspend accounts used for fraud, abuse, or repeated failed COD deliveries.
              </li>
            </ul>
          ),
        },
        {
          heading: 'Products, prices and availability',
          body: (
            <ul className="list-disc space-y-1 pl-5">
              <li>
                All prices are in Indian Rupees (₹) and, where configured, inclusive of applicable
                taxes. Shipping is displayed separately at checkout.
              </li>
              <li>
                Despite our best efforts, occasional errors (pricing, descriptions, availability)
                can occur. If we cannot fulfil an order at the displayed price or an item is
                unavailable, we will inform you and refund any amount paid — we are not obliged to
                supply at an erroneous price.
              </li>
              <li>Product images are indicative; colours may vary slightly between screens.</li>
              <li>
                Availability shown at checkout reflects real-time stock but, for supplier-fulfilled
                items, rare shortfalls are possible — you will be informed and refunded promptly if
                so.
              </li>
            </ul>
          ),
        },
        {
          heading: 'Orders and payment',
          body: (
            <ul className="list-disc space-y-1 pl-5">
              <li>
                An order is an offer to buy. A contract forms when we confirm the order (email or
                order status <em>Confirmed</em>), not merely when an order number is generated.
              </li>
              <li>
                Online payments are processed by licensed payment gateway providers; we never handle
                card data.{' '}
                {settings.shipping.codEnabled
                  ? `Cash on Delivery is available${settings.shipping.codFeePaise > 0 ? ` with a ${formatINR(settings.shipping.codFeePaise)} handling fee` : ''}.`
                  : ''}
              </li>
              <li>
                Orders awaiting payment may be cancelled automatically if payment is not completed
                within the stated window.
              </li>
              <li>
                Coupons and promotions cannot be exchanged for cash and may be withdrawn at any
                time.
              </li>
            </ul>
          ),
        },
        {
          heading: 'Cancellation',
          body: (
            <p>
              {settings.policies.cancellationWindowHours > 0
                ? `You may cancel within ${settings.policies.cancellationWindowHours} hours of placing an order and in any case before it ships.`
                : 'You may cancel an order before it ships.'}{' '}
              Refunds follow the{' '}
              <Link href="/policies/returns" className="link-primary">
                Returns &amp; Refunds Policy
              </Link>
              .
            </p>
          ),
        },
        {
          heading: 'Prohibited use',
          body: (
            <p>
              You agree not to: resell access, scrape or overload the site, attempt unauthorised
              access, interfere with payment flows, place fraudulent orders (including repeated COD
              refusals), or use the store for any unlawful purpose.
            </p>
          ),
        },
        {
          heading: 'Intellectual property',
          body: (
            <p>
              Store branding, text and software are owned by{' '}
              {settings.business.legalName || settings.storeName} or its licensors. Product
              names/logos belong to their respective owners and are used for identification only.
            </p>
          ),
        },
        {
          heading: 'Limitation of liability',
          body: (
            <p>
              To the maximum extent permitted by law, our total liability for any order is limited
              to the amount paid for that order. We are not liable for indirect or consequential
              losses. Nothing in these terms limits liability that cannot be limited under Indian
              law, including for fraud or defective products under statutory warranties.
            </p>
          ),
        },
        {
          heading: 'Force majeure',
          body: (
            <p>
              We are not liable for delays caused by events beyond reasonable control (natural
              disasters, courier network failures, government actions, payment-provider outages).
              Affected orders may be delayed or cancelled with a full refund.
            </p>
          ),
        },
        {
          heading: 'Governing law and disputes',
          body: (
            <p>
              These terms are governed by the laws of India. Courts at{' '}
              {settings.business.city || '[store owner’s jurisdiction]'} have exclusive
              jurisdiction, without prejudice to consumer forum rights available to you under the
              Consumer Protection Act, 2019.
            </p>
          ),
        },
        {
          heading: 'Changes',
          body: (
            <p>
              We may update these terms; the &ldquo;Last updated&rdquo; date above always reflects
              the current version.
            </p>
          ),
        },
      ]}
    />
  );
}
