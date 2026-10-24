import Link from 'next/link';
import { configuredSupportEmail, type StoreSettings } from '@/lib/settings';

/**
 * Renders the store's support e-mail as a mailto link — but only once a real
 * address is configured in Admin → Settings. Until then it points people at
 * the contact form (which stores messages in the admin inbox) instead of
 * showing the shipped `support@example.com` placeholder to customers.
 *
 * `fallback` lets copy-heavy sentences read naturally, e.g.
 *   "… by emailing <SupportContact fallback=\"us via the contact form\" />."
 */
export function SupportContact({
  settings,
  fallback = 'our contact form',
  className = 'link-primary',
}: {
  settings: Pick<StoreSettings, 'supportEmail'>;
  fallback?: string;
  className?: string;
}) {
  const email = configuredSupportEmail(settings);
  if (email) {
    return (
      <a href={`mailto:${email}`} className={`${className} break-all`}>
        {email}
      </a>
    );
  }
  return (
    <Link href="/contact" className={className}>
      {fallback}
    </Link>
  );
}
