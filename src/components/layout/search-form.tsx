'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useEffect, type FormEvent } from 'react';

const STORAGE_KEY = 'zenvora_recent_searches';

export function SearchForm() {
  const [q, setQ] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const router = useRouter();
  const inputId = useId();

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setRecent(JSON.parse(stored) as string[]);
    } catch {
      // localStorage unavailable (private mode) or a corrupt payload. Recent
      // searches are a progressive enhancement, so failing to read them must
      // never break the search box.
    }
  }, []);

  function onSubmit(e?: FormEvent, termOverride?: string) {
    if (e) e.preventDefault();
    const term = (termOverride ?? q).trim();
    
    if (term) {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        let items: string[] = stored ? JSON.parse(stored) : [];
        items = items.filter(i => i.toLowerCase() !== term.toLowerCase());
        items.unshift(term);
        items = items.slice(0, 5);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
        setRecent(items);
      } catch {
        // Storage can be unavailable or over quota. The search still submits,
        // so swallow it rather than surfacing a storage error to the shopper.
      }
    }
    
    setShowDropdown(false);
    router.push(term ? `/search?q=${encodeURIComponent(term)}` : '/shop');
  }

  return (
    <div className="relative w-full">
      <form onSubmit={(e) => onSubmit(e)} role="search" className="relative w-full">
        <label htmlFor={inputId} className="sr-only">
          Search products
        </label>
        <input
          id={inputId}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
          placeholder="Search catalog, SKU, brand…"
          className="input-base h-10 w-full rounded-full border-ink-900/15 bg-white/95 pl-9 pr-16 text-sm shadow-hair focus:bg-white focus:border-brand-300"
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

      {showDropdown && recent.length > 0 && (
        <div className="absolute top-12 left-0 right-0 z-50 rounded-xl border border-ink-900/10 bg-white p-2 shadow-lift">
          <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-ink-400">Recent searches</p>
          <ul className="mt-1">
            {recent.map((term) => (
              <li key={term}>
                <button
                  type="button"
                  onClick={() => {
                    setQ(term);
                    onSubmit(undefined, term);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink-800 hover:bg-ink-900/5"
                >
                  <svg className="h-3.5 w-3.5 text-ink-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {term}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}