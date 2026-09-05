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
      <p className="text-5xl" aria-hidden="true">
        ⚠️
      </p>
      <h1 className="mt-4">Something went wrong</h1>
      <p className="mt-2 max-w-md text-sm text-gray-500">
        An unexpected error occurred while loading this page. Your cart and orders are safe. If this
        keeps happening, please contact support.
        {error.digest && (
          <span className="block pt-1 font-mono text-xs text-gray-400">
            Error ref: {error.digest}
          </span>
        )}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-brand-600 px-5 py-2.5 text-base font-medium text-white hover:bg-brand-700"
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
