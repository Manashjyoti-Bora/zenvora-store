import type { ReactNode } from 'react';
import Link from 'next/link';
import { Alert } from '@/components/ui/feedback';
import { formatINR } from '@/lib/money';
import type { StoreSettings } from '@/lib/settings';

export interface PolicySection {
  heading: string;
  body: ReactNode;
}

export function PolicyView({
  title,
  lastUpdated,
  sections,
  settings,
}: {
  title: string;
  lastUpdated: string;
  sections: PolicySection[];
  settings: StoreSettings;
}) {
  return (
    <div className="container-store max-w-3xl py-8 sm:py-12">
      <header className="mb-6">
        <h1>{title}</h1>
        <p className="mt-2 text-xs text-ink-400">
          Last updated: {lastUpdated} · Applies to orders placed on {settings.storeName}
        </p>
      </header>

      <Alert tone="warning" className="mb-6">
        This policy is provided as a starting template by the platform. The store owner must review
        it (ideally with legal counsel) for accuracy and Indian legal compliance — including the
        Consumer Protection (E-Commerce) Rules 2020 and IT Act requirements — before taking live
        orders. Nothing here is legal advice.
      </Alert>

      <div className="space-y-7 text-sm leading-relaxed text-ink-700 sm:text-[15px]">
        {sections.map((s, i) => (
          <section key={s.heading} aria-labelledby={`policy-${i}`}>
            <h2 id={`policy-${i}`}>
              {i + 1}. {s.heading}
            </h2>
            <div className="mt-2 space-y-2">{s.body}</div>
          </section>
        ))}
        <section aria-labelledby="policy-contact">
          <h2 id="policy-contact">Contact</h2>
          <p className="mt-2">
            Questions about this policy? Email{' '}
            <a href={`mailto:${settings.supportEmail}`} className="link-primary">
              {settings.supportEmail}
            </a>
            {settings.supportPhone ? <> or call {settings.supportPhone}</> : null}
            {settings.business.legalName ? <> ({settings.business.legalName})</> : null}.
          </p>
        </section>
      </div>

      <nav
        className="mt-10 flex flex-wrap gap-3 border-t border-ink-900/10 pt-5 text-sm"
        aria-label="Other policies"
      >
        <Link href="/policies/privacy" className="link-primary">
          Privacy Policy
        </Link>
        <Link href="/policies/terms" className="link-primary">
          Terms &amp; Conditions
        </Link>
        <Link href="/policies/shipping" className="link-primary">
          Shipping Policy
        </Link>
        <Link href="/policies/returns" className="link-primary">
          Returns &amp; Refunds
        </Link>
      </nav>
    </div>
  );
}

export function policySettingsContext(s: StoreSettings) {
  return {
    freeShippingText:
      s.shipping.freeAbovePaise > 0
        ? `free shipping on prepaid orders above ${formatINR(s.shipping.freeAbovePaise)}`
        : 'no free-shipping threshold configured',
    flatShippingText: formatINR(s.shipping.flatRatePaise),
    codText: s.shipping.codEnabled
      ? `Cash on Delivery is available${s.shipping.codFeePaise > 0 ? ` with a handling fee of ${formatINR(s.shipping.codFeePaise)}` : ''}`
      : 'Cash on Delivery is currently not offered',
  };
}
