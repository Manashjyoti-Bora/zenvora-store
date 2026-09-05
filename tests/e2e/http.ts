/**
 * Minimal HTTP agent for E2E specs: cookie jar + automatic CSRF echo.
 *
 * Mirrors what a real browser does:
 *  - stores every Set-Cookie (including the httpOnly session cookie),
 *  - sends stored cookies on subsequent requests,
 *  - captures the readable `resellix_csrf` cookie issued by the middleware and
 *    echoes it as `x-csrf-token` on unsafe methods (double-submit pattern),
 *  - never follows redirects automatically so specs can assert 307/302 + Location.
 *
 * Uses global fetch (Node 20 undici) — no extra dependencies.
 */
import { E2E_BASE_URL } from './env';

export type Json = unknown;

export interface E2EResponse {
  status: number;
  headers: Headers;
  body: string;
  json<T = Json>(): T | undefined;
  location(): string | null;
}

export interface RequestOptions {
  /** Send cookies from the jar (default true). */
  cookies?: boolean;
  /** Echo the CSRF token on unsafe methods (default true). Set false to test CSRF rejection. */
  csrf?: boolean;
  /** Extra headers. */
  headers?: Record<string, string>;
  /** Raw string body (instead of JSON). */
  rawBody?: string;
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function parseSetCookie(value: string): { name: string; value: string } | null {
  const firstPart = value.split(';')[0] ?? '';
  const idx = firstPart.indexOf('=');
  if (idx <= 0) return null;
  return { name: firstPart.slice(0, idx).trim(), value: firstPart.slice(idx + 1).trim() };
}

export class HttpAgent {
  private readonly jar = new Map<string, string>();
  public csrfToken: string | null = null;

  constructor(private readonly baseUrl: string = E2E_BASE_URL) {}

  get cookies(): ReadonlyMap<string, string> {
    return this.jar;
  }

  clear(): void {
    this.jar.clear();
    this.csrfToken = null;
  }

  async request(method: string, path: string, body?: Json, opts: RequestOptions = {}): Promise<E2EResponse> {
    const headers: Record<string, string> = {
      accept: 'application/json, text/html;q=0.9',
      'user-agent': 'resellix-e2e/1.0',
      ...(opts.headers ?? {}),
    };

    if (opts.cookies !== false && this.jar.size > 0) {
      headers.cookie = [...this.jar.entries()].map(([n, v]) => `${n}=${v}`).join('; ');
    }

    let payload: string | undefined;
    if (opts.rawBody !== undefined) {
      payload = opts.rawBody;
      headers['content-type'] ??= 'application/json';
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['content-type'] = 'application/json';
    }

    if (opts.csrf !== false && UNSAFE.has(method) && this.csrfToken) {
      headers['x-csrf-token'] = this.csrfToken;
    }

    const res = await fetch(`${this.baseUrl}${path}`, { method, headers, body: payload, redirect: 'manual' });

    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const parsed = parseSetCookie(raw);
      if (!parsed) continue;
      if (parsed.value === '' || /;\s*(?:Max-Age=0|Expires=Thu, 01 Jan 1970)/i.test(raw)) {
        this.jar.delete(parsed.name);
      } else {
        this.jar.set(parsed.name, parsed.value);
      }
    }
    this.csrfToken = this.jar.get('resellix_csrf') ?? null;

    const text = await res.text();
    return {
      status: res.status,
      headers: res.headers,
      body: text,
      json<T = Json>(): T | undefined {
        if (!text) return undefined;
        try {
          return JSON.parse(text) as T;
        } catch {
          return undefined;
        }
      },
      location(): string | null {
        return res.headers.get('location');
      },
    };
  }

  get(path: string, opts?: RequestOptions) {
    return this.request('GET', path, undefined, opts);
  }
  post(path: string, body?: Json, opts?: RequestOptions) {
    return this.request('POST', path, body, opts);
  }
  patch(path: string, body?: Json, opts?: RequestOptions) {
    return this.request('PATCH', path, body, opts);
  }
  put(path: string, body?: Json, opts?: RequestOptions) {
    return this.request('PUT', path, body, opts);
  }
  del(path: string, body?: Json, opts?: RequestOptions) {
    return this.request('DELETE', path, body, opts);
  }
}

/** Poll a URL until the dev server answers (compile-on-first-request can take a while). */
export async function waitForServer(baseUrl: string = E2E_BASE_URL, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`, { redirect: 'manual' });
      if (res.status < 500) return;
      lastError = new Error(`health status ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`Server at ${baseUrl} not ready: ${String(lastError)}`);
}

/** Unique-but-valid email for isolated test accounts. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}+${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}@e2e.example`;
}

// ---------------------------------------------------------------------------
// Response envelopes (src/lib/errors.ts):
//   success → { ok: true, data: ... }        (jsonOk)
//   error   → { error: { code, message, details } }  (handleApiError)
// Raw routes (health, webhooks, cron) answer without an envelope.
// ---------------------------------------------------------------------------

export function okData<T>(res: E2EResponse): T | undefined {
  return res.json<{ ok?: boolean; data?: T }>()?.data;
}

export function errMessage(res: E2EResponse): string | undefined {
  return res.json<{ error?: { message?: string } }>()?.error?.message;
}

export function errCode(res: E2EResponse): string | undefined {
  return res.json<{ error?: { code?: string } }>()?.error?.code;
}

/** Poll a predicate until it returns a truthy value (job runner is async). */
export async function pollUntil<T>(fn: () => Promise<T> | T, timeoutMs = 20_000, intervalMs = 500): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last as T;
}
