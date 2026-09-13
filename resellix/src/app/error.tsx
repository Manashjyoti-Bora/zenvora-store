'use client';

import { useEffect } from 'react';
import { LinkButton } from '@/components/ui/button';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The platform logger captures server errors; this keeps a client-side
    // trace without leaking details into the UI.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('resellix-client-error', {
          detail: { message: error.message, digest: error.digest },
        })
      );
    }
  }, [error]);

  return (
    <div className="container-store flex flex-col items-center py-20 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-cream-100 text-ink-700 ring-1 ring-ink-900/10" aria-hidden="true">
        <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v5" />
          <circle cx="12" cy="16.5" r="0.5" fill="currentColor" />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.6 3.9 2.7 17.4A1.6 1.6 0 0 0 4.1 19.8h15.8a1.6 1.6 0 0 0 1.4-2.4L13.4 3.9a1.6 1.6 0 0 0-2.8 0Z"
          />
        </svg>
      </span>
      <h1 className="display mt-5 text-2xl text-ink-900 sm:text-3xl">Something went wrong</h1>
      <p className="mt-2 max-w-md text-sm text-ink-400">
        An unexpected error occurred while loading this page. Your cart and orders are safe. If this
        keeps happening, please contact support.
        {error.digest && (
          <span className="block pt-1 font-mono text-xs text-ink-400">
            Error ref: {error.digest}
          </span>
        )}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="btn-press rounded-lg bg-brand-600 px-5 py-2.5 text-base font-medium text-white shadow-soft transition-colors hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          Try again
        </button>
        <LinkButton href="/" variant="outline" size="lg">
          Go home
        </LinkButton>
      </div>
    </div>
  );
}
