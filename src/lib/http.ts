import { NextResponse } from 'next/server';
import { payloadTooLarge } from './errors';

/** Extract the best-effort client IP (proxies set x-forwarded-for). */
export function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return null;
}

/**
 * Default cap for JSON request bodies. Generous for every real form in the
 * app (the largest, the admin product form with 12 images + 60 variants +
 * a 20k-char description, is well under 200 KB) while bounding how much
 * work schema validation can be made to do: zod accumulates one issue per
 * failing array element regardless of `.max()` (GHSA-mrhx-c7xc-m3w5), so the
 * body size — not the schema — is what limits memory.
 */
export const DEFAULT_MAX_JSON_BYTES = 1_000_000;

/**
 * Safely read + JSON-parse a request body; returns null when invalid.
 * Throws a 413 ApiError when the body exceeds `maxBytes` (never silently
 * truncates).
 */
export async function readJson(
  req: Request,
  opts: { maxBytes?: number } = {}
): Promise<unknown> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_JSON_BYTES;
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw payloadTooLarge(maxBytes);
  let text: string;
  try {
    text = await req.text();
  } catch {
    return null;
  }
  // Byte length, not char length: a body can lie about (or omit) content-length.
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw payloadTooLarge(maxBytes);
  try {
    return JSON.parse(text) as unknown;
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
