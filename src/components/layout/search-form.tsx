'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { formatINR } from '@/lib/money';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'zenvora_recent_searches';
const DEBOUNCE_MS = 220;
const MIN_CHARS = 2;

interface SuggestProduct {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  pricePaise: number;
  categoryName: string | null;
}
interface SuggestCategory {
  slug: string;
  name: string;
  productCount: number;
}
interface SuggestPayload {
  query: string;
  products: SuggestProduct[];
  categories: SuggestCategory[];
}

type Option =
  | { kind: 'recent'; label: string; href: string }
  | { kind: 'product'; label: string; href: string; meta: string }
  | { kind: 'category'; label: string; href: string; meta: string }
  | { kind: 'all'; label: string; href: string };

function readRecent(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? (JSON.parse(stored) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    // localStorage unavailable (private mode) or a corrupt payload. Recent
    // searches are a progressive enhancement and must never break search.
    return [];
  }
}

function rememberTerm(term: string): string[] {
  const items = [term, ...readRecent().filter((i) => i.toLowerCase() !== term.toLowerCase())].slice(0, 5);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage may be unavailable or over quota — the search still submits.
  }
  return items;
}

/**
 * Header search: form submit navigates to /search (works without JS). While
 * typing, a debounced, cancellable request to /api/search/suggest powers an
 * accessible combobox with real catalogue matches. Stale responses are dropped.
 */
export function SearchForm({ initialQuery = '' }: { initialQuery?: string }) {
  const router = useRouter();
  const inputId = useId();
  const listId = `${inputId}-listbox`;

  const [q, setQ] = useState(initialQuery);
  const [recent, setRecent] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [suggest, setSuggest] = useState<SuggestPayload | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRecent(readRecent());
  }, []);

  // Close on outside click / focus leaving the widget.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const cancelPending = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => cancelPending, [cancelPending]);

  // Debounced + cancellable suggestion fetch.
  useEffect(() => {
    const term = q.trim();
    cancelPending();
    if (term.length < MIN_CHARS) {
      setSuggest(null);
      setLoading(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      const seq = ++seqRef.current;
      setLoading(true);
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`suggest ${res.status}`);
        const body = (await res.json()) as { ok: boolean; data?: SuggestPayload };
        // Drop out-of-order responses (a slower earlier request must not
        // overwrite the result for what the shopper is typing now).
        if (seq !== seqRef.current) return;
        setSuggest(body.data ?? null);
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        if (seq === seqRef.current) setSuggest(null);
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return cancelPending;
  }, [q, cancelPending]);

  const term = q.trim();
  const showRecent = term.length < MIN_CHARS && recent.length > 0;
  const options: Option[] = showRecent
    ? recent.map((r) => ({ kind: 'recent', label: r, href: `/search?q=${encodeURIComponent(r)}` }))
    : term.length >= MIN_CHARS
      ? [
          ...(suggest?.products ?? []).map<Option>((p) => ({
            kind: 'product',
            label: p.name,
            href: `/products/${p.slug}`,
            meta: [p.brand, p.categoryName].filter(Boolean).join(' · ') || formatINR(p.pricePaise),
          })),
          ...(suggest?.categories ?? []).map<Option>((c) => ({
            kind: 'category',
            label: c.name,
            href: `/search?q=${encodeURIComponent(term)}&category=${encodeURIComponent(c.slug)}`,
            meta: `${c.productCount} product${c.productCount === 1 ? '' : 's'}`,
          })),
          { kind: 'all', label: `Search for “${term}”`, href: `/search?q=${encodeURIComponent(term)}` },
        ]
      : [];

  const listOpen = open && options.length > 0;

  function go(href: string, remember?: string) {
    cancelPending();
    if (remember) setRecent(rememberTerm(remember));
    setOpen(false);
    setActive(-1);
    router.push(href);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (listOpen && active >= 0 && options[active]) {
      const opt = options[active];
      go(opt.href, opt.kind === 'recent' || opt.kind === 'all' ? term || opt.label : undefined);
      return;
    }
    if (term) go(`/search?q=${encodeURIComponent(term)}`, term);
    else go('/shop');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!listOpen) {
      if (e.key === 'ArrowDown' && options.length > 0) {
        setOpen(true);
        setActive(0);
        e.preventDefault();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((i) => (i + 1) % options.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        setActive(-1);
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  }

  return (
    <div ref={rootRef} className="relative w-full">
      <form onSubmit={onSubmit} role="search" className="relative w-full" action="/search" method="get">
        <label htmlFor={inputId} className="sr-only">
          Search products
        </label>
        <input
          id={inputId}
          name="q"
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search catalog, SKU, brand…"
          className="input-base h-10 w-full rounded-full border-ink-900/15 bg-white/95 pl-9 pr-16 text-sm shadow-hair focus:bg-white focus:border-brand-300"
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-activedescendant={listOpen && active >= 0 ? `${listId}-opt-${active}` : undefined}
          aria-busy={loading || undefined}
          maxLength={80}
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

      <div
        id={listId}
        role="listbox"
        aria-label={showRecent ? 'Recent searches' : 'Search suggestions'}
        className={cn(
          'glass-panel absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-xl p-2 motion-reveal',
          listOpen ? 'block' : 'hidden'
        )}
      >
        <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-ink-400">
          {showRecent ? 'Recent searches' : loading && !suggest ? 'Searching…' : 'Suggestions'}
        </p>
        <ul className="mt-1">
          {options.map((opt, i) => (
            <li key={`${opt.kind}-${opt.href}`}>
              <Link
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={active === i}
                href={opt.href}
                tabIndex={-1}
                onMouseEnter={() => setActive(i)}
                onClick={(e) => {
                  e.preventDefault();
                  go(opt.href, opt.kind === 'recent' ? opt.label : opt.kind === 'all' ? term : undefined);
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-ink-800 transition-colors',
                  active === i ? 'bg-ink-900/5' : 'hover:bg-ink-900/5'
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {opt.kind === 'recent' ? (
                    <svg className="h-3.5 w-3.5 shrink-0 text-ink-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ) : opt.kind === 'category' ? (
                    <span className="shrink-0 rounded-full bg-sage-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-700">
                      Category
                    </span>
                  ) : null}
                  <span className={cn('truncate', opt.kind === 'all' && 'font-medium text-brand-700')}>{opt.label}</span>
                </span>
                {'meta' in opt && <span className="shrink-0 text-xs text-ink-400">{opt.meta}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      {/* Screen-reader status for async results (visual list is aria-live-free to avoid chatter). */}
      <p className="sr-only" aria-live="polite">
        {term.length >= MIN_CHARS && suggest && !loading
          ? suggest.products.length > 0
            ? `${suggest.products.length} suggestion${suggest.products.length === 1 ? '' : 's'} available.`
            : 'No matching products yet. Press Enter to search.'
          : ''}
      </p>
    </div>
  );
}
