'use client';

import { LinkButton } from '@/components/ui/button';

export default function ShopError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section
      className="container-store py-12 sm:py-16"
      aria-labelledby="catalog-error-title"
      role="alert"
    >
      <div className="mx-auto max-w-2xl rounded-2xl border border-red-900/15 bg-white p-6 text-center shadow-soft sm:p-9">
        <p className="eyebrow text-red-700">Catalogue unavailable</p>
        <h1 id="catalog-error-title" className="display mt-2 text-2xl text-ink-900 sm:text-3xl">
          We couldn’t load the catalogue
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-ink-500">
          This is a temporary loading problem, not an empty-catalogue message. Your cart and account
          are safe. Please try again in a moment.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-xs text-ink-400">Reference: {error.digest}</p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="btn-press min-h-11 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Try again
          </button>
          <LinkButton href="/" variant="outline" size="md">
            Go to homepage
          </LinkButton>
        </div>
      </div>
    </section>
  );
}
