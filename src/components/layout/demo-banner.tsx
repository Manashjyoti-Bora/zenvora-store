import Link from 'next/link';
import { WarnIcon } from '@/components/ui/icons';

/**
 * Demo-mode banner. Shown whenever settings.demoMode is true so nobody can
 * mistake test data / TEST payments for a live production store.
 */
export function DemoBanner({ demoMode }: { demoMode: boolean }) {
  if (!demoMode) return null;
  return (
    <div
      className="border-b border-accent-300/25 bg-ink-900 px-3 py-1.5 text-center text-[11px] font-medium text-cream-100 sm:px-4 sm:text-xs"
      role="status"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-2 gap-y-0.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-accent-300/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-300 ring-1 ring-accent-300/35">
          <WarnIcon className="h-3 w-3 shrink-0 text-accent-300" />
          Demo Mode
        </span>
        <span className="text-cream-100/90">
          Sample catalog &amp; test payments only — no real orders are fulfilled.
        </span>
        <Link
          href="/faq#demo-mode"
          className="font-semibold text-accent-300 underline decoration-accent-300/50 underline-offset-2 transition-colors hover:text-white hover:no-underline"
        >
          What is this?
        </Link>
      </div>
    </div>
  );
}
