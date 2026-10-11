import Link from 'next/link';
import { cn } from '@/lib/utils';
import { CheckIcon } from '@/components/ui/icons';

export type CheckoutStepId = 'cart' | 'checkout' | 'confirmation';

const STEPS: { id: CheckoutStepId; label: string; href?: string }[] = [
  { id: 'cart', label: 'Shopping Bag', href: '/cart' },
  { id: 'checkout', label: 'Address & Payment' },
  { id: 'confirmation', label: 'Confirmation' },
];

export function CheckoutSteps({ current }: { current: CheckoutStepId }) {
  const currentIdx = STEPS.findIndex((s) => s.id === current);

  return (
    <nav
      aria-label="Checkout progress"
      className="mb-6 flex items-center justify-between gap-2 rounded-xl border border-ink-900/10 bg-white px-4 py-3 shadow-hair sm:justify-start sm:gap-6 sm:px-5"
    >
      <ol className="flex w-full items-center justify-between gap-2 text-xs sm:w-auto sm:justify-start sm:gap-6">
        {STEPS.map((step, i) => {
          const isCompleted = i < currentIdx;
          const isCurrent = i === currentIdx;
          const badge = (
            <span
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors',
                isCompleted && 'bg-brand-600 text-white',
                isCurrent && 'bg-ink-950 text-brass-300 ring-2 ring-brass-300/40',
                !isCompleted && !isCurrent && 'bg-cream-100 text-ink-400 ring-1 ring-ink-900/10'
              )}
            >
              {isCompleted ? <CheckIcon className="h-3.5 w-3.5" /> : i + 1}
            </span>
          );

          const text = (
            <span
              className={cn(
                'truncate font-medium',
                isCurrent ? 'font-semibold text-ink-900' : isCompleted ? 'text-ink-700' : 'text-ink-400'
              )}
            >
              {step.label}
            </span>
          );

          return (
            <li
              key={step.id}
              aria-current={isCurrent ? 'step' : undefined}
              className="flex min-w-0 items-center gap-2"
            >
              {isCompleted && step.href ? (
                <Link
                  href={step.href}
                  className="inline-flex min-w-0 items-center gap-2 hover:text-brand-700"
                >
                  {badge}
                  {text}
                </Link>
              ) : (
                <span className="inline-flex min-w-0 items-center gap-2">
                  {badge}
                  {text}
                </span>
              )}
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'ml-1 hidden h-px w-6 sm:inline-block',
                    i < currentIdx ? 'bg-brand-500' : 'bg-ink-900/15'
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
