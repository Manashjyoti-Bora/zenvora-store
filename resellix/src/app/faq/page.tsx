import type { Metadata } from 'next';
import Link from 'next/link';
import { getSettings } from '@/lib/settings';
import { env } from '@/lib/env';
import { formatINR } from '@/lib/money';
import { DemoExplainer } from '@/components/store/demo-explainer';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return {
    title: 'Frequently asked questions',
    description: `Answers about ordering, payments, shipping, returns and refunds at ${settings.storeName}.`,
    alternates: { canonical: '/faq' },
  };
}

export default async function FaqPage() {
  const s = await getSettings();

  const faqs = [
    {
      q: 'How do I place an order?',
      a: (
        <>
          Add products to your cart, go to{' '}
          <Link href="/cart" className="link-primary">
            checkout
          </Link>
          , enter your shipping address and choose a payment method. You can check out as a guest —
          no account needed — though an account gives you order history, saved addresses and faster
          tracking.
        </>
      ),
    },
    {
      q: 'Which payment methods do you accept?',
      a: (
        <>
          {s.shipping.codEnabled
            ? 'Online payment (UPI, cards, netbanking — processed by our licensed payment gateway provider) and Cash on Delivery.'
            : 'Online payment via UPI, cards and netbanking, processed by our licensed payment gateway provider.'}{' '}
          We never see or store your card number, CVV or UPI PIN — those are entered only in the
          gateway&apos;s secure window.
          {s.shipping.codEnabled && s.shipping.codFeePaise > 0 && (
            <>
              {' '}
              Cash on Delivery carries a small handling fee of {formatINR(s.shipping.codFeePaise)},
              shown at checkout.
            </>
          )}
        </>
      ),
    },
    {
      q: 'Is my payment safe? What if money is debited but the order fails?',
      a: (
        <>
          Payments are confirmed only after server-side verification with the gateway, so a failed
          or interrupted payment never marks an order as paid. If your bank shows a debit but the
          order is not confirmed, <strong>do not pay again</strong> — contact{' '}
          <Link href="/contact" className="link-primary">
            support
          </Link>{' '}
          with your order number. Unsettled amounts are auto-refunded by the gateway, typically
          within 5–7 business days.
        </>
      ),
    },
    {
      q: 'How long does delivery take?',
      a: (
        <>
          Most orders are delivered in {s.shipping.estimatedDaysMin}–{s.shipping.estimatedDaysMax}{' '}
          business days after dispatch. You will receive tracking details by email and can follow
          live status on the{' '}
          <Link href="/track" className="link-primary">
            tracking page
          </Link>
          .
        </>
      ),
    },
    {
      q: 'What does shipping cost?',
      a: (
        <>
          {s.shipping.freeAbovePaise > 0 ? (
            <>
              Shipping is <strong>free</strong> on prepaid orders above{' '}
              {formatINR(s.shipping.freeAbovePaise)}. Below that, a flat rate of{' '}
              {formatINR(s.shipping.flatRatePaise)} applies.
            </>
          ) : (
            <>
              A flat shipping rate of {formatINR(s.shipping.flatRatePaise)} applies to all orders.
            </>
          )}{' '}
          The exact amount is always shown in your cart and at checkout before you pay.
        </>
      ),
    },
    {
      q: 'Can I cancel my order?',
      a: (
        <>
          {s.policies.cancellationWindowHours > 0 ? (
            <>
              Yes — while the order has not shipped, and within {s.policies.cancellationWindowHours}{' '}
              hours of placing it. Use the <em>Cancel order</em> button on your order page (log in,
              or use the confirmation link from your email).
            </>
          ) : (
            <>
              Orders can be cancelled before they ship. Use the <em>Cancel order</em> button on your
              order page as soon as possible.
            </>
          )}{' '}
          Paid orders are refunded to the original payment method; COD orders are simply cancelled.
          See the{' '}
          <Link href="/policies/returns" className="link-primary">
            returns &amp; refunds policy
          </Link>
          .
        </>
      ),
    },
    {
      q: 'How do returns and refunds work?',
      a: (
        <>
          {s.policies.returnWindowDays > 0 ? (
            <>
              Returns are accepted within <strong>{s.policies.returnWindowDays} days</strong> of
              delivery for eligible items (see policy for exclusions). Request a return from your
              order page; our team reviews every request and responds by email. Approved refunds go
              back to the original payment method, usually within 5–7 business days after we receive
              and check the item.
            </>
          ) : (
            <>
              Our returns policy explains eligibility and the process. Request a return from your
              order page; our team reviews every request and responds by email.
            </>
          )}{' '}
          <Link href="/policies/returns" className="link-primary">
            Read the full policy
          </Link>
          .
        </>
      ),
    },
    {
      q: 'How do I track a guest order (without an account)?',
      a: (
        <>
          Use the{' '}
          <Link href="/track" className="link-primary">
            tracking page
          </Link>{' '}
          with your order number (from the confirmation email, format RX-YYMMDD-XXXXXX) and the
          email address you used at checkout. Both are required to protect your privacy.
        </>
      ),
    },
    {
      q: 'Are prices inclusive of taxes (GST)?',
      a: (
        <>
          {s.tax.pricesIncludeTax
            ? 'Yes — displayed prices include applicable GST. A tax invoice with your order is available on request; GSTIN (if registered) is shown in the footer once configured.'
            : 'Applicable taxes are added and shown separately at checkout before you pay.'}
        </>
      ),
    },
    {
      q: 'How is my personal data used?',
      a: (
        <>
          Only to process your orders, deliver them and support you — never sold to third parties.
          Details in our{' '}
          <Link href="/policies/privacy" className="link-primary">
            privacy policy
          </Link>
          . You can request export or deletion of your data by emailing{' '}
          <a href={`mailto:${s.supportEmail}`} className="link-primary">
            {s.supportEmail}
          </a>
          .
        </>
      ),
    },
    {
      q: 'Do you ship outside India?',
      a: <>Currently we ship within India only.</>,
    },
  ];

  // Plain-text mirrors of the answers above, for structured data.
  const faqText: Record<string, string> = {
    'How do I place an order?':
      'Add products to your cart, proceed to checkout, enter your shipping address and choose a payment method. Guest checkout is supported; an account adds order history and saved addresses.',
    'Which payment methods do you accept?': s.shipping.codEnabled
      ? 'Online payment (UPI, cards, netbanking via our licensed payment gateway) and Cash on Delivery. Card details are never seen or stored by the store.'
      : 'Online payment via UPI, cards and netbanking through our licensed payment gateway. Card details are never seen or stored by the store.',
    'Is my payment safe? What if money is debited but the order fails?':
      'Payments are confirmed only after server-side verification with the gateway. If money is debited but the order is not confirmed, do not pay again - contact support with your order number. Unsettled amounts are typically auto-refunded within 5-7 business days.',
    'How long does delivery take?': `Most orders arrive in ${s.shipping.estimatedDaysMin}-${s.shipping.estimatedDaysMax} business days after dispatch, with tracking by email and on the tracking page.`,
    'What does shipping cost?':
      s.shipping.freeAbovePaise > 0
        ? `Free shipping on prepaid orders above Rs ${s.shipping.freeAbovePaise / 100}; otherwise a flat rate of Rs ${s.shipping.flatRatePaise / 100}. The exact amount is shown at checkout.`
        : `A flat shipping rate of Rs ${s.shipping.flatRatePaise / 100} applies and is shown at checkout.`,
    'Can I cancel my order?':
      s.policies.cancellationWindowHours > 0
        ? `Yes, before the order ships and within ${s.policies.cancellationWindowHours} hours of placing it, using the Cancel button on your order page. Paid orders are refunded to the original payment method.`
        : 'Orders can be cancelled before they ship using the Cancel button on your order page. Paid orders are refunded to the original payment method.',
    'How do returns and refunds work?':
      s.policies.returnWindowDays > 0
        ? `Returns are accepted within ${s.policies.returnWindowDays} days of delivery for eligible items. Request a return from your order page; approved refunds return to the original payment method, usually within 5-7 business days after inspection.`
        : 'See the returns policy. Request a return from your order page; approved refunds return to the original payment method.',
    'How do I track a guest order (without an account)?':
      'Use the tracking page with your order number (format RX-YYMMDD-XXXXXX from your confirmation email) and the email used at checkout.',
    'Are prices inclusive of taxes (GST)?': s.tax.pricesIncludeTax
      ? 'Yes, displayed prices include applicable GST.'
      : 'Applicable taxes are added and shown separately at checkout.',
    'How is my personal data used?':
      'Only to process, deliver and support your orders. Data is never sold. Export or deletion can be requested by email.',
    'Do you ship outside India?': 'Currently we ship within India only.',
  };

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faqText[f.q] ?? 'See the answer on our FAQ page.',
      },
    })),
    url: `${env.APP_URL}/faq`,
  };

  return (
    <div className="container-store max-w-3xl py-8 sm:py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header className="mb-8">
        <h1>Frequently asked questions</h1>
        <p className="mt-2 text-sm text-ink-500">
          Everything about ordering, payments, delivery and returns. Can&apos;t find your answer?{' '}
          <Link href="/contact" className="link-primary">
            Contact us
          </Link>
          .
        </p>
      </header>

      <div id="demo-mode" className="mb-8 scroll-mt-24">
        {s.demoMode && <DemoExplainer />}
      </div>

      <div className="divide-y divide-ink-900/10 rounded-xl border border-ink-900/10 bg-white">
        {faqs.map((f, i) => (
          <details key={i} className="group p-4 sm:p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-ink-900 sm:text-base">
              {f.q}
              <span
                className="shrink-0 text-ink-400 transition-transform group-open:rotate-45"
                aria-hidden="true"
              >
                ＋
              </span>
            </summary>
            <div className="mt-3 text-sm leading-relaxed text-ink-500">{f.a}</div>
          </details>
        ))}
      </div>
    </div>
  );
}
