'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { focusablesIn, lockBodyScroll, nextFocusTarget } from '@/lib/a11y/focus';

/**
 * Accessible modal dialog: role=dialog + aria-modal, ESC to close, click on
 * backdrop to close, focus moved into the dialog and restored on close.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    focusablesIn(ref.current)[0]?.focus();

    // Focus trap + scroll lock shared with <MobileMenu> (src/lib/a11y/focus.ts)
    // so every overlay in the app behaves identically for keyboard users.
    const releaseScrollLock = lockBodyScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const target = nextFocusTarget(focusablesIn(ref.current), document.activeElement, e.shiftKey);
      if (!target) return;
      e.preventDefault();
      target.focus();
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      releaseScrollLock();
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="glass-scrim motion-fade fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'glass-panel motion-pop max-h-[92vh] w-full overflow-y-auto rounded-t-2xl sm:rounded-2xl',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md'
        )}
      >
        <header className="flex items-center justify-between border-b border-ink-900/10 bg-cream-50/50 px-5 py-3.5">
          <h2 className="text-base font-semibold text-ink-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="btn-press rounded-lg p-1.5 text-ink-400 hover:bg-cream-100 hover:text-ink-700"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <footer className="border-t border-ink-900/10 bg-cream-50/40 px-5 py-3.5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
