import Link from 'next/link';
import { WarnIcon } from '@/components/ui/icons';

/**
 * Shown on the home page and FAQ while settings.demoMode is true.
 * Keeps the demo/production boundary unmistakable while staying compact
 * and legible at 320px–390px mobile viewports.
 */
export function DemoExplainer({ activeCount }: { activeCount?: number } = {}) {
  const hasProducts = activeCount === undefined || activeCount > 0;

  return (
    <div
      role="note"
      aria-label="Demo mode notice"
      className="rounded-2xl border border-amber-300/70 bg-gradient-to-br from-amber-50/90 via-cream-50 to-white p-4 text-ink-800 shadow-hair sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800 ring-1 ring-amber-300/60">
            <WarnIcon className="h-4 w-4" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-amber-900 sm:text-sm">
              This store is running in demo mode
            </p>
            <p className="text-[11px] text-ink-500 sm:text-xs">
              Evaluation environment — test payments only, no real orders are fulfilled.
            </p>
          </div>
        </div>
        <Link
          href="/admin/settings"
          className="rounded-full border border-amber-300/80 bg-white px-3 py-1 text-[11px] font-semibold text-amber-900 shadow-hair transition-colors hover:border-amber-400 hover:bg-amber-50"
        >
          Admin → Settings
        </Link>
      </div>

      <ul className="mt-3 grid grid-cols-1 gap-2 border-t border-amber-200/60 pt-3 text-xs text-ink-600 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-1.5">
        <li className="flex items-start gap-2">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
          <span>
            {hasProducts
              ? 'Products shown are sample catalog entries for evaluating the platform.'
              : 'No active storefront products are published yet; sample or live catalog items can be added from Admin.'}
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
          <span>
            Payments (when enabled) run through a clearly-labelled TEST provider — no real money
            moves.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
          <span>Orders placed here are not fulfilled or shipped.</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
          <span>
            The owner can switch off demo mode in <strong>Admin → Settings</strong> once real
            products, payment credentials and shipping arrangements are configured (see
            SETUP_CHECKLIST.md).
          </span>
        </li>
      </ul>
    </div>
  );
}
