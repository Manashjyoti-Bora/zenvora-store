import { vi } from 'vitest';

/**
 * next/headers `cookies()` only works inside a Next.js request scope.
 * Integration tests exercise the same service code (cart, sessions) outside
 * of Next, so we replace the cookie store with an in-memory jar.
 *
 * The jar lives on globalThis so test files can inspect/clear it:
 *   const jar = (globalThis as any).__cookieJar as Map<string, { value: string }>
 */
vi.mock('next/headers', () => {
  const g = globalThis as { __cookieJar?: Map<string, { value: string }> };
  if (!g.__cookieJar) g.__cookieJar = new Map();
  return {
    cookies: async () => ({
      get: (name: string) => g.__cookieJar!.get(name),
      set: (name: string, value: string) => {
        g.__cookieJar!.set(name, { value });
      },
      delete: (name: string) => {
        g.__cookieJar!.delete(name);
      },
    }),
    // Some modules import headers() too; provide a harmless stub.
    headers: async () => new Map(),
  };
});

export function clearCookieJar(): void {
  const g = globalThis as { __cookieJar?: Map<string, { value: string }> };
  g.__cookieJar?.clear();
}
