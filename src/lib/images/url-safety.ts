/**
 * Product media URL safety.
 *
 * A product image/video URL ends up in customer browsers (`<img src>`,
 * `<video src>`, Open Graph tags, JSON-LD) and may be requested by the image
 * optimizer. We therefore accept only:
 *
 *   - site-relative uploads: `/uploads/<path>` (no `..`, no protocol-relative `//`)
 *   - absolute `https://` URLs with a public, named host (no credentials, no IP
 *     literals, no localhost / link-local / private-network names)
 *
 * Plain `http://` is rejected on purpose: the storefront is served over HTTPS,
 * so such images would be blocked as mixed content and the product would ship
 * with a broken gallery. `javascript:` / `data:` / `vbscript:` are never media.
 *
 * Pure function, no imports — safe to use from zod schemas, server code and
 * the supplier importer alike.
 */

const BLOCKED_HOST_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home', '.arpa'];
const BLOCKED_HOSTS = new Set(['localhost', '0.0.0.0', 'metadata.google.internal']);

function isIpLiteral(host: string): boolean {
  // IPv4 dotted quad, or bracketed IPv6 (WHATWG URL keeps the brackets in `hostname`).
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[');
}

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (!h || BLOCKED_HOSTS.has(h)) return true;
  if (isIpLiteral(h)) return true;
  if (!h.includes('.')) return true; // bare single-label names are intranet names
  return BLOCKED_HOST_SUFFIXES.some((s) => h.endsWith(s));
}

export const MAX_MEDIA_URL_LENGTH = 2000;

/** True when `url` is acceptable as a product image or video source. */
export function isSafeMediaUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > MAX_MEDIA_URL_LENGTH) return false;
  // Control characters / whitespace inside the URL are never legitimate.
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f) return false;
  }

  if (trimmed.startsWith('/')) {
    if (trimmed.startsWith('//')) return false; // protocol-relative → remote
    if (!trimmed.startsWith('/uploads/')) return false;
    return !trimmed.split('/').some((seg) => seg === '..' || seg === '.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  if (isBlockedHost(parsed.hostname)) return false;
  return true;
}

/** Message used by zod refinements and admin forms. */
export const UNSAFE_MEDIA_URL_MESSAGE =
  'Use an https:// URL on a public host, or an uploaded file (/uploads/…).';
