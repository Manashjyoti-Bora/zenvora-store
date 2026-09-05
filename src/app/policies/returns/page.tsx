import type { Metadata } from 'next';
import Link from 'next/link';
import { getSettings } from '@/lib/settings';
import { env } from '@/lib/env';
import { PolicyView } from '@/components/policies/policy-view';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return {
    title: 'Returns & Refunds Policy',
    description: `How to return products and get refunds at ${settings.storeName}.`,
    alternates: { canonical: '/policies/returns' },
    openGraph: {
      title: `Returns & Refunds | ${settings.storeName}`,
      url: `${env.APP_URL}/policies/returns`,
    },
  };
}

const LAST_UPDATED = '2026-09-05';

export default async function ReturnsPage() {
  const settings = await getSettings();
  const windowDays = settings.policies.returnWindowDays;

  return (
    <PolicyView
      title="Returns & Refunds Policy"
      lastUpdated={LAST_UPDATED}
      settings={settings}
      sections={[
        {
          heading: 'Cancellation window',
          body: (
            <p>
              {settings.policies.cancellationWindowHours > 0
                ? `Orders can be cancelled from your order page within ${settings.policies.cancellationWindowHours} hours of placing them and before dispatch.`
                : 'Orders can be cancelled from your order page before dispatch.'}{' '}
              Cancelled prepaid orders are refunded in full (including shipping).
            </p>
          ),
        },
        {
          heading: 'Return window & eligibility',
          body: (
            <>
              <p>
                {windowDays > 0 ? (
                  <>
                    Returns are accepted within <strong>{windowDays} days of delivery</strong> when
                    the item is:
                  </>
                ) : (
                  <>Returns are accepted when the item is:</>
                )}
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Damaged, defective or materially different from its description on arrival;</li>
                <li>Wrong item delivered; or</li>
                <li>
                  Eligible for change-of-mind return in unused, unwashed condition with original
                  packaging, tags and accessories (where the product page marks it returnable).
                </li>
              </ul>
              <p>
                Certain categories are non-returnable for hygiene/safety reasons (e.g. innerwear,
                cosmetics, perishables) unless defective — this is stated on the product page.
              </p>
            </>
          ),
        },
        {
          heading: 'How to request a return',
          body: (
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                Open the order from{' '}
                <Link href="/account/orders" className="link-primary">
                  My orders
                </Link>{' '}
                (or the confirmation email link) and tap <em>Request return / refund</em>.
              </li>
              <li>Choose the item and reason; add photos by email if the item is damaged.</li>
              <li>
                Our team reviews requests within 2 business days and confirms pickup or replacement
                by email.
              </li>
            </ol>
          ),
        },
        {
          heading: 'Refunds',
          body: (
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Refunds are issued to the <strong>original payment method</strong> after the
                returned item is received and passes quality check — typically 5–7 business days for
                UPI/cards/netbanking (bank processing times vary).
              </li>
              <li>
                COD orders: refunds are issued via bank transfer/UPI to an account you provide.
              </li>
              <li>
                Partial refunds apply when only some items are returned or when usage/damage reduces
                value (we will always tell you why).
              </li>
              <li>
                Original shipping is refunded when the return is due to our error (damaged/wrong
                item).
              </li>
            </ul>
          ),
        },
        {
          heading: 'Replacements',
          body: (
            <p>
              For damaged/wrong items we prefer an immediate replacement where stock allows;
              otherwise you receive a full refund. Replacement dispatch timelines follow the{' '}
              <Link href="/policies/shipping" className="link-primary">
                Shipping Policy
              </Link>
              .
            </p>
          ),
        },
        {
          heading: 'Items lost or damaged in transit',
          body: (
            <p>
              If tracking shows delivered but you did not receive the parcel, contact us within 48
              hours — we will investigate with the courier and refund or re-ship as appropriate.
            </p>
          ),
        },
        {
          heading: 'Statutory rights',
          body: (
            <p>
              This policy is in addition to, and never limits, your rights under the Consumer
              Protection Act, 2019 and applicable Indian law for defective goods.
            </p>
          ),
        },
      ]}
    />
  );
}
