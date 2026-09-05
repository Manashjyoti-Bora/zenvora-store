'use client';

/**
 * Browser-side API helper.
 * - Attaches the double-submit CSRF token from the readable cookie.
 * - Normalises error responses into ApiClientError with field details.
 */

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: Array<{ path: string; message: string }> | unknown
  ) {
    super(message);
    this.name = 'ApiClientError';
  }

  fieldError(path: string): string | undefined {
    if (Array.isArray(this.details)) {
      return this.details.find((d) => d.path === path)?.message;
    }
    return undefined;
  }
}

export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function apiFetch<T = unknown>(url: string, opts: ApiFetchOptions = {}): Promise<T> {
  const method = opts.method ?? 'POST';
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = getCookie('resellix_csrf');
    if (csrf) headers['x-csrf-token'] = csrf;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
    cache: 'no-store',
  });

  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    data?: T;
    error?: { message?: string; details?: unknown };
  } | null;

  if (!res.ok) {
    throw new ApiClientError(
      res.status,
      json?.error?.message ?? `Request failed (${res.status})`,
      json?.error?.details
    );
  }
  return (json && 'data' in json ? json.data : json) as T;
}

/** Generate a per-checkout idempotency key (stable for the page session). */
export function checkoutIdempotencyKey(): string {
  if (typeof window === 'undefined') return '';
  const KEY = 'resellix_checkout_key';
  let key = sessionStorage.getItem(KEY);
  if (!key) {
    key = `chk_${Date.now()}_${crypto.randomUUID()}`;
    sessionStorage.setItem(KEY, key);
  }
  return key;
}

export function clearCheckoutIdempotencyKey(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem('resellix_checkout_key');
}
