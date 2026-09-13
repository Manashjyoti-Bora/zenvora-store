import type { Metadata } from 'next';
import { getSettings } from '@/lib/settings';
import { env } from '@/lib/env';
import { PolicyView } from '@/components/policies/policy-view';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return {
    title: 'Privacy Policy',
    description: `How ${settings.storeName} collects, uses and protects your personal data.`,
    alternates: { canonical: '/policies/privacy' },
    openGraph: {
      title: `Privacy Policy | ${settings.storeName}`,
      url: `${env.APP_URL}/policies/privacy`,
    },
  };
}

const LAST_UPDATED = '2026-09-05';

export default async function PrivacyPolicyPage() {
  const settings = await getSettings();

  return (
    <PolicyView
      title="Privacy Policy"
      lastUpdated={LAST_UPDATED}
      settings={settings}
      sections={[
        {
          heading: 'What we collect',
          body: (
            <>
              <p>We collect only what is needed to run your orders:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  <strong>Account data:</strong> name, email, mobile number and a password stored
                  only as a cryptographic hash (never in plain text).
                </li>
                <li>
                  <strong>Order data:</strong> shipping address, order contents, amounts, and
                  order/tracking history.
                </li>
                <li>
                  <strong>Payment references:</strong> gateway order/payment IDs and statuses.{' '}
                  <strong>
                    We never see or store card numbers, CVVs, UPI PINs or netbanking credentials
                  </strong>{' '}
                  — those are entered only into the payment gateway&apos;s secure interface.
                </li>
                <li>
                  <strong>Technical data:</strong> IP address and request metadata for security
                  (rate limiting, fraud and abuse prevention) and error diagnosis.
                </li>
              </ul>
            </>
          ),
        },
        {
          heading: 'Why we process it (legal bases)',
          body: (
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Contract performance:</strong> processing payment, fulfilling and delivering
                your order, handling returns/refunds.
              </li>
              <li>
                <strong>Legal obligations:</strong> tax/accounting records (e.g. GST invoices),
                responses to lawful requests.
              </li>
              <li>
                <strong>Legitimate interests:</strong> security, fraud prevention, service
                reliability.
              </li>
              <li>
                <strong>Consent:</strong> marketing emails only if and when you opt in; you can
                withdraw at any time.
              </li>
            </ul>
          ),
        },
        {
          heading: 'Cookies',
          body: (
            <p>
              We use only <strong>essential cookies</strong>: your login session, your cart and a
              CSRF security token. No third-party advertising or tracking cookies are set by this
              store by default. If analytics are added in future, they will be disclosed here and
              gated behind the cookie preferences notice.
            </p>
          ),
        },
        {
          heading: 'Who we share data with',
          body: (
            <>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  <strong>Payment gateway providers</strong> (e.g. Razorpay) — to process payments
                  and refunds.
                </li>
                <li>
                  <strong>Suppliers &amp; logistics partners</strong> — the minimum needed to fulfil
                  and deliver your order (name, address, phone, items).
                </li>
                <li>
                  <strong>Email/SMS infrastructure providers</strong> — to send transactional
                  notifications.
                </li>
                <li>
                  <strong>Hosting/infrastructure providers</strong> — where this application and
                  database run.
                </li>
              </ul>
              <p>We do not sell your personal data, ever.</p>
            </>
          ),
        },
        {
          heading: 'Retention',
          body: (
            <p>
              Order and transaction records are retained as required by Indian tax and commercial
              law (commonly 8 years for financial records). Account data is retained while your
              account is active; login sessions expire automatically. You may request deletion of
              your account, subject to retention obligations for past orders.
            </p>
          ),
        },
        {
          heading: 'Security',
          body: (
            <p>
              Passwords are hashed with bcrypt. Sessions use httpOnly, SameSite cookies. All
              sensitive operations are protected against CSRF, rate limiting is applied to
              authentication and checkout endpoints, and payment confirmations require server-side
              gateway verification. Despite these measures, no system is 100% secure; report any
              concern to us immediately.
            </p>
          ),
        },
        {
          heading: 'Your rights',
          body: (
            <p>
              Subject to applicable law (including the Digital Personal Data Protection Act, 2023 as
              brought into force), you can request access to, correction of, or deletion of your
              personal data, and object to or restrict certain processing. Email{' '}
              <a href={`mailto:${settings.supportEmail}`} className="link-primary">
                {settings.supportEmail}
              </a>{' '}
              from your registered address and we will respond within 30 days.
            </p>
          ),
        },
        {
          heading: 'Children',
          body: (
            <p>
              This store is not directed at children under 18; we do not knowingly collect their
              data.
            </p>
          ),
        },
        {
          heading: 'Changes to this policy',
          body: (
            <p>
              Material changes will be reflected in the &ldquo;Last updated&rdquo; date above and,
              where appropriate, announced by email or a site banner.
            </p>
          ),
        },
        {
          heading: 'Grievance officer',
          body: (
            <p>
              As required for Indian e-commerce entities, grievance contact:{' '}
              <a href={`mailto:${settings.supportEmail}`} className="link-primary">
                {settings.supportEmail}
              </a>
              {settings.business.legalName
                ? `, ${settings.business.legalName}`
                : ' (to be appointed by the store owner before launch)'}
              .
            </p>
          ),
        },
      ]}
    />
  );
}
