import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind-aware className combiner. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const SLUG_RE = /[^a-z0-9]+/g;

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(SLUG_RE, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Format an ISO date for Indian locale display. */
export function formatDate(value: Date | string | null | undefined, withTime = false): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
  }).format(d);
}

/** Stable key for a cart line (variant-aware). */
export function cartLineKey(productId: string, variantId?: string | null): string {
  return variantId ? `${productId}:${variantId}` : productId;
}

/**
 * Serialize JSON-LD for safe inline `<script type="application/ld+json">`
 * embedding.
 *
 * JSON.stringify does NOT escape `<`, `>` or `&`. Structured data here is
 * built from database strings (product names/descriptions — which can arrive
 * via supplier sync — category names, FAQ content, store settings), so a value
 * containing `</script>` would prematurely close the tag and inject arbitrary
 * markup into customer-facing pages (stored XSS). Escaping to `\u003c` etc.
 * is invisible to JSON parsers and search engines but inert in HTML.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/[<>&]/g, (ch) =>
    ch === '<' ? '\\u003c' : ch === '>' ? '\\u003e' : '\\u0026'
  );
}
