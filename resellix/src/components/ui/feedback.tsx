import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';
import { InfoIcon, CheckIcon, WarnIcon, XIcon, BoxIcon } from './icons';

type AlertTone = 'info' | 'success' | 'warning' | 'error';

const alertTones: Record<AlertTone, string> = {
  info: 'bg-blue-50 text-blue-800 border-blue-200',
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  error: 'bg-red-50 text-red-800 border-red-200',
};

const alertIcons: Record<AlertTone, ReactNode> = {
  info: <InfoIcon className="h-4 w-4" />,
  success: <CheckIcon className="h-4 w-4" />,
  warning: <WarnIcon className="h-4 w-4" />,
  error: <XIcon className="h-4 w-4" />,
};

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm',
        alertTones[tone],
        className
      )}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <span aria-hidden="true" className="mt-0.5 font-bold">
        {alertIcons[tone]}
      </span>      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'break-words')}>{children}</div>}
      </div>
    </div>
  );
}

export function Card({
  title,
  action,
  children,
  className,
  padded = true,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={cn('card', className)}
      aria-label={typeof title === 'string' ? title : undefined}
    >
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-ink-900/10 px-4 py-3 sm:px-5">
          {title && <h2 className="text-base font-semibold text-ink-900">{title}</h2>}
          {action}
        </header>
      )}
      <div className={padded ? 'p-4 sm:p-5' : ''}>{children}</div>
    </section>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  /** Any node: an <Icon/> from ui/icons on storefront surfaces; legacy emoji
   *  strings keep rendering (ReactNode) so existing call sites never break. */
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const content = icon ?? <BoxIcon className="h-6 w-6" />;
  const isGlyph = typeof content === 'string';
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-900/15 bg-cream-50 px-6 py-12 text-center">
      {isGlyph ? (
        <span aria-hidden="true" className="text-3xl">
          {content}
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-ink-500 shadow-hair ring-1 ring-ink-900/10"
        >
          {content}
        </span>
      )}
      <h3 className="mt-4 text-sm font-semibold text-ink-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm leading-relaxed text-ink-400">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'neutral' | 'positive' | 'negative' | 'info';
}) {
  const toneClass = {
    neutral: 'text-ink-900',
    positive: 'text-emerald-700',
    negative: 'text-red-700',
    info: 'text-blue-700',
  }[tone];
  return (
    <div className="card p-4">
      <dt className="truncate text-xs font-medium uppercase tracking-wide text-ink-400">
        {label}
      </dt>
      <dd className={cn('mt-1 text-xl font-bold tabular-nums sm:text-2xl', toneClass)}>{value}</dd>
      {sub && <dd className="mt-1 text-xs text-ink-400">{sub}</dd>}
    </div>
  );
}
