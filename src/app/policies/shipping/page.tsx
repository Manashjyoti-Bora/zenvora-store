import type { Metadata } from 'next';
import { getSettings } from '@/lib/settings';
import { env } from '@/lib/env';
import { PolicyView, policySettingsContext } from '@/components/policies/policy-view';
import { formatINR } from '@/lib/money';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return {
    title: 'Shipping Policy',
    description: `Delivery times, shipping charges and tracking at ${settings.storeName}.`,
    alternates: { canonical: '/policies/shipping' },
    openGraph: {
      title: `Shipping Policy | ${settings.storeName}`,
      url: `${env.APP_URL}/policies/shipping`,
    },
  };
}

const LAST_UPDATED = '2026-09-05';

export default async function ShippingPolicyPage() {
  const settings = await getSettings();
  const ctx = policySettingsContext(settings);

  return (
    <PolicyView
      title="Shipping Policy"
      lastUpdated={LAST_UPDATED}
      settings={settings}
      sections={[
        {
          heading: 'Where we ship',
          body: (
            <p>
              We currently ship to addresses within India. Serviceability of remote PIN codes
              depends on our courier partners; if your order cannot be delivered we will inform you
              and refund any prepaid amount.
            </p>
          ),
        },
        {
          heading: 'Processing time',
          body: (
            <p>
              Orders are confirmed instantly on successful payment (or immediately for COD).
              Dispatch/handover to our fulfilment network typically happens within 1–2 business
              days, subject to supplier stock. You will be notified by email at each step.
            </p>
          ),
        },
        {
          heading: 'Delivery timelines',
          body: (
            <p>
              Estimated delivery is{' '}
              <strong>
                {settings.shipping.estimatedDaysMin}–{settings.shipping.estimatedDaysMax} business
                days
              </strong>{' '}
              after dispatch, depending on destination and courier. Festive seasons and weather can
              extend this; the tracking page always shows the latest status.
            </p>
          ),
        },
        {
          heading: 'Shipping charges',
          body: (
            <ul className="list-disc space-y-1 pl-5">
              <li>
                {ctx.freeShippingText.charAt(0).toUpperCase() + ctx.freeShippingText.slice(1)}.
              </li>
              <li>Otherwise a flat rate of {ctx.flatShippingText} applies.</li>
              <li>{ctx.codText.charAt(0).toUpperCase() + ctx.codText.slice(1)}.</li>
              <li>
                Charges are always shown in the cart and at checkout before you pay — no surprises
                on delivery.
              </li>
            </ul>
          ),
        },
        {
          heading: 'Tracking',
          body: (
            <p>
              Once dispatched, tracking details (carrier, tracking number, live status) are emailed
              to you and shown on the order page and our public tracking page (order number + email
              required).
            </p>
          ),
        },
        {
          heading: 'Failed and refused deliveries',
          body: (
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Couriers typically attempt delivery 2–3 times; please keep your phone reachable.
              </li>
              <li>
                Undelivered orders are returned to us. Prepaid orders can be re-shipped on request
                or refunded (original shipping may be deducted where the courier charges us for the
                failed attempt).
              </li>
              <li>Repeated COD refusals may lead to COD being disabled for your account.</li>
            </ul>
          ),
        },
        {
          heading: 'Damaged or wrong deliveries',
          body: (
            <p>
              Inspect parcels at delivery where possible. If an item arrives damaged, wrong or
              tampered with, record an unboxing video if you can and contact us within 48 hours with
              photos — we will replace or refund per the{' '}
              <a href="/policies/returns" className="link-primary">
                Returns &amp; Refunds Policy
              </a>
              .
            </p>
          ),
        },
        {
          heading: 'Freight charges note',
          body: (
            <p>
              Shipping charged to you ({formatINR(settings.shipping.flatRatePaise)} flat / free
              above {formatINR(settings.shipping.freeAbovePaise)}) is our customer-facing policy;
              actual courier costs are borne by us and vary by zone and weight.
            </p>
          ),
        },
      ]}
    />
  );
}
