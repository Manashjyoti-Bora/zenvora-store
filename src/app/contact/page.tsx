import type { Metadata } from 'next';
import { MailIcon, PhoneIcon } from '@/components/ui/icons';
import Link from 'next/link';
import { getSettings } from '@/lib/settings';
import { getCurrentUser } from '@/lib/auth/guards';
import { ContactForm } from '@/components/contact-form';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return {
    title: 'Contact us',
    description: `Get help with orders, payments, returns or anything else from the ${settings.storeName} support team.`,
    alternates: { canonical: '/contact' },
  };
}

export default async function ContactPage() {
  const [settings, user] = await Promise.all([getSettings(), getCurrentUser()]);

  return (
    <div className="container-store max-w-3xl py-8 sm:py-12">
      <header className="mb-6">
        <h1>Contact us</h1>
        <p className="mt-2 text-sm text-ink-500">
          Questions about a product, an order, a payment or a return? Send us a message and our team
          will get back to you within 1 business day.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_260px]">
        <ContactForm defaultName={user?.name ?? ''} defaultEmail={user?.email ?? ''} />

        <aside className="space-y-4" aria-label="Other ways to contact us">
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-ink-900">Direct channels</h2>
            <ul className="mt-2 space-y-2 text-sm text-ink-500">
              <li className="flex items-start gap-2">
                <MailIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                <a href={`mailto:${settings.supportEmail}`} className="link-primary break-all">
                  {settings.supportEmail}
                </a>
              </li>
              {settings.supportPhone && (
                <li className="flex items-center gap-2">
                  <PhoneIcon className="h-4 w-4 shrink-0 text-ink-400" />
                  {settings.supportPhone}
                </li>
              )}
            </ul>
          </div>
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-ink-900">Quick help</h2>
            <ul className="mt-2 space-y-1.5 text-sm">
              <li>
                <Link href="/track" className="link-primary">
                  Track an order
                </Link>
              </li>
              <li>
                <Link href="/faq" className="link-primary">
                  Read the FAQ
                </Link>
              </li>
              <li>
                <Link href="/policies/returns" className="link-primary">
                  Returns &amp; refunds policy
                </Link>
              </li>
              <li>
                <Link href="/policies/shipping" className="link-primary">
                  Shipping policy
                </Link>
              </li>
            </ul>
          </div>
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-ink-900">Response times</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-400">
              Support hours: Mon–Sat, 10:00–18:00 IST. Payment disputes: contact us within 48 hours
              of a suspicious debit with your order number — do not retry the payment.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
