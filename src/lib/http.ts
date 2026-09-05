import { NextResponse } from 'next/server';

/** Extract the best-effort client IP (proxies set x-forwarded-for). */
export function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return null;
}

/** Safely read + JSON-parse a request body; returns null when invalid. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** Read the raw body text (needed for webhook HMAC verification). */
export async function readRawBody(req: Request): Promise<string> {
  return req.text();
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}
