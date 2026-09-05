import Link from 'next/link';

/**
 * Demo-mode banner. Shown whenever settings.demoMode is true so nobody can
 * mistake test data / TEST payments for a live production store.
 */
export function DemoBanner({ demoMode }: { demoMode: boolean }) {
  if (!demoMode) return null;
  return (
    <div
      className="flex items-center justify-center gap-2 bg-amber-400 px-4 py-1.5 text-center text-xs font-semibold text-amber-950"
      role="status"
    >
      <span aria-hidden="true">⚠️</span>
      <span>
        DEMO MODE — sample catalog &amp; test payments only. No real orders are fulfilled.{' '}
        <Link href="/faq#demo-mode" className="underline hover:no-underline">
          What is this?
        </Link>
      </span>
    </div>
  );
}
