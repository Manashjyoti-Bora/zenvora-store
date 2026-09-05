import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

type AlertTone = 'info' | 'success' | 'warning' | 'error';

const alertTones: Record<AlertTone, string> = {
  info: 'bg-blue-50 text-blue-800 border-blue-200',
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  error: 'bg-red-50 text-red-800 border-red-200',
};

const alertIcons: Record<AlertTone, string> = {
  info: 'ℹ️',
  success: '✓',
  warning: '⚠',
  error: '✕',
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
      </span>
      <div className="min-w-0 flex-1">
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
        <header className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 sm:px-5">
          {title && <h2 className="text-base font-semibold text-gray-900">{title}</h2>}
          {action}
        </header>
      )}
      <div className={padded ? 'p-4 sm:p-5' : ''}>{children}</div>
    </section>
  );
}

export function EmptyState({
  icon = '📦',
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
      <span aria-hidden="true" className="text-3xl">
        {icon}
      </span>
      <h3 className="mt-3 text-sm font-semibold text-gray-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-gray-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
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
    neutral: 'text-gray-900',
    positive: 'text-emerald-700',
    negative: 'text-red-700',
    info: 'text-blue-700',
  }[tone];
  return (
    <div className="card p-4">
      <dt className="truncate text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </dt>
      <dd className={cn('mt-1 text-xl font-bold tabular-nums sm:text-2xl', toneClass)}>{value}</dd>
      {sub && <dd className="mt-1 text-xs text-gray-500">{sub}</dd>}
    </div>
  );
}
