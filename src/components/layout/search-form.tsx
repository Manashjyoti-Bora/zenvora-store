'use client';

import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

const STORAGE_KEY = 'zenvora_recent_searches';
const MAX_RECENT = 5;

/**
 * Storefront search box with recent-search suggestions.
 *
 * Accessibility: the suggestion list is a real ARIA 1.2 combobox - the input
 * carries role="combobox" with aria-expanded / aria-controls /
 aria-activedescendant, and the suggestions are role="option" inside a
 * role="listbox". It is fully keyboard operable (Down/Up/Home/End to move,
 * Enter to choose, Escape to dismiss) and announces the suggestion count on a
 * polite live region, so it is usable with a screen reader or keyboard alone.
 *
 * Recent searches are a progressive enhancement: every localStorage access is
 * guarded, so a blocked or full store never breaks search itself.
 */
export function SearchForm() {
  const [q, setQ] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const router = useRouter();
  const inputId = useId();
  const listboxId = `${inputId}-recent-listbox`;
  const optionId = (index: number) => `${inputId}-recent-option-${index}`;

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const readRecent = useCallback((): string[] => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return [];
      const parsed: unknown = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_RECENT);
    } catch {
      // localStorage unavailable (private mode) or a corrupt payload. Recent
      // searches are a progressive enhancement, so failing to read them must
      // never break the search box.
      return [];
    }
  }, []);

  useEffect(() => {
    setRecent(readRecent());
  }, [readRecent]);

  const persist = useCallback((term: string) => {
    try {
      const items = (() => {
        try {
          const stored = localStorage.getItem(STORAGE_KEY);
          if (!stored) return [] as string[];
          const parsed: unknown = JSON.parse(stored);
          if (!Array.isArray(parsed)) return [] as string[];
          return parsed.filter((v): v is string => typeof v === 'string');
        } catch {
          // Unreadable history is treated as empty so the new term still saves.
          return [] as string[];
        }
      })();

      const next = [term, ...items.filter((i) => i.toLowerCase() !== term.toLowerCase())].slice(
        0,
        MAX_RECENT
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setRecent(next);
    } catch {
      // Storage unavailable or over quota. The search still submits, so swallow
      // it rather than surfacing a storage error to the shopper.
    }
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  const submit = useCallback(
    (term: string) => {
      const trimmed = term.trim();
      if (trimmed) persist(trimmed);
      close();
      inputRef.current?.blur();
      router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/shop');
    },
    [persist, close, router]
  );

  // Dismiss when a tap/click lands outside the search box. Using pointerdown
  // (rather than the input's blur) keeps a click on a suggestion working:
  // blur-based closing used a 200ms timeout race that swallowed real clicks.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) close();
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit(q);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        close();
      }
      return;
    }

    if (recent.length === 0) return;

    if (!open) {
      // First Down arrow opens the list rather than moving a selection.
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
        setActiveIndex(0);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % recent.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => (i <= 0 ? recent.length - 1 : i - 1));
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(recent.length - 1);
        break;
      case 'Enter':
        // Enter runs the highlighted suggestion; without one, submit the typed
        // query (the form's own submit handler covers that case).
        if (activeIndex >= 0) {
          e.preventDefault();
          submit(recent[activeIndex]);
        }
        break;
      default:
        break;
    }
  }

  const expanded = open && recent.length > 0;

  return (
    <div ref={containerRef} className="relative w-full">
      <form onSubmit={onSubmit} role="search" className="relative w-full">
        <label htmlFor={inputId} className="sr-only">
          Search products
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => {
            if (recent.length > 0) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search catalog, SKU, brand…"
          className="input-base h-10 w-full rounded-full border-ink-900/15 bg-white/95 pl-9 pr-16 text-sm shadow-hair focus:border-brand-300 focus:bg-white"
          autoComplete="off"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={expanded && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-describedby={`${inputId}-hint`}
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
            d="M21 21l-5.197-5.197m0 0A7.5 0 105.196 5.196a7.5 0 0010.607 10.607z"
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

      {/* Keyboard hint for assistive tech; announced when the list opens. */}
      <span id={`${inputId}-hint`} className="sr-only">
        Use the up and down arrow keys to review recent searches, Enter to search, Escape to close.
      </span>
      <span role="status" aria-live="polite" className="sr-only">
        {expanded
          ? `${recent.length} recent ${recent.length === 1 ? 'search' : 'searches'} available.`
          : ''}
      </span>

      {expanded && (
        <div className="absolute left-0 right-0 top-12 z-50 rounded-xl border border-ink-900/10 bg-white p-2 shadow-lift">
          <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-ink-400">
            Recent searches
          </p>
          <ul id={listboxId} role="listbox" aria-label="Recent searches" className="mt-1">
            {recent.map((term, index) => {
              const active = index === activeIndex;
              return (
                <li
                  key={term}
                  id={optionId(index)}
                  role="option"
                  aria-selected={active}
                  className={active ? 'rounded-lg bg-ink-900/5' : 'rounded-lg'}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    // Keep focus on the input so aria-activedescendant stays
                    // authoritative for screen readers.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setQ(term);
                      submit(term);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink-800 hover:bg-ink-900/5"
                  >
                    <svg
                      className="h-3.5 w-3.5 shrink-0 text-ink-300"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <span className="truncate">{term}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
