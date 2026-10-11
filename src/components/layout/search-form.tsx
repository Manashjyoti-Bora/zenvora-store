'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';

export function SearchForm() {
  const [q, setQ] = useState('');
  const router = useRouter();
  const inputId = useId();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const term = q.trim();
    router.push(term ? `/search?q=${encodeURIComponent(term)}` : '/shop');
  }

  return (
    <form onSubmit={onSubmit} role="search" className="relative w-full">
      <label htmlFor={inputId} className="sr-only">
        Search products
      </label>
      <input
        id={inputId}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search catalog, SKU, brand…"
        className="input-base h-10 rounded-full border-ink-900/15 bg-white/95 pl-9 pr-16 text-sm shadow-hair focus:bg-white"
        autoComplete="off"
      />
      <svg
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
        />
      </svg>
      <button
        type="submit"
        aria-label="Search"
        className="btn-press absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-ink-900/5 px-2.5 py-1 text-[11px] font-semibold text-ink-700 transition-colors hover:bg-brand-600 hover:text-white"
      >
        Find
      </button>
    </form>
  );
}
