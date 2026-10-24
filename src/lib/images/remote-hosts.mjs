/**
 * Allow-list of remote hosts the Next.js image optimizer may fetch from.
 *
 * Plain ESM (no TypeScript) on purpose: it is imported by `next.config.mjs`
 * at build time AND by application code, so both sides agree on exactly one
 * list. The resolved list is also inlined into the client bundle as
 * `NEXT_PUBLIC_IMAGE_REMOTE_HOSTS` (see next.config.mjs → `env`), which is how
 * `<RemoteImage>` decides whether a URL can go through `/_next/image`.
 *
 * Why not `hostname: '**'`: the optimizer is a server-side fetcher. Leaving it
 * open lets anyone use `/_next/image?url=https://…` to make the deployment
 * download arbitrary URLs (bandwidth, SSRF surface, cache poisoning).
 *
 * Why the application still renders unknown hosts: products imported from a
 * supplier may reference a CDN not in the list. Those images are rendered
 * with `unoptimized` (plain `<img>` straight from the origin) instead of
 * throwing the "hostname is not configured" runtime error that would 500 a
 * product page.
 *
 * Configuration: `IMAGE_REMOTE_HOSTS="cdn.example.com,**.other.net"`
 * (comma-separated, Next.js `remotePatterns` hostname syntax; `*` = one
 * label, `**` = any number of labels). The value REPLACES the defaults so an
 * operator can also tighten the list. Hosts of configured storage providers
 * (S3 public base URL / endpoint, Cloudinary) are always appended.
 */

/** Hosts the project integrates with out of the box. */
export const DEFAULT_IMAGE_REMOTE_HOSTS = Object.freeze([
  // CJdropshipping product media (several CDN domains are in use).
  '**.cjdropshipping.com',
  '**.aliyuncs.com',
  // Cloudinary delivery (STORAGE_PROVIDER=cloudinary).
  'res.cloudinary.com',
  // AWS S3 virtual-hosted buckets (STORAGE_PROVIDER=s3).
  '**.amazonaws.com',
]);

const HOST_PATTERN = /^(\*\*?\.)?[a-z0-9-]+(\.[a-z0-9-]+)*$/i;

function hostOf(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the effective allow-list from the environment.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @returns {string[]} unique, validated hostname patterns
 */
export function resolveImageRemoteHosts(env = process.env) {
  const configured = (env.IMAGE_REMOTE_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const base = configured.length > 0 ? configured : [...DEFAULT_IMAGE_REMOTE_HOSTS];
  const extra = [hostOf(env.S3_PUBLIC_BASE_URL), hostOf(env.S3_ENDPOINT)].filter(Boolean);
  if (env.S3_BUCKET && env.S3_ENDPOINT) {
    // R2 / MinIO style virtual-hosted URL (`<bucket>.<endpoint host>`), see src/lib/storage/s3.ts.
    const endpointHost = hostOf(env.S3_ENDPOINT);
    if (endpointHost) extra.push(`${env.S3_BUCKET}.${endpointHost}`.toLowerCase());
  }
  const all = [...base, ...extra].filter((h) => HOST_PATTERN.test(h));
  return [...new Set(all)];
}

/**
 * Does `hostname` match one `remotePatterns`-style pattern?
 *  - exact: `cdn.example.com`
 *  - `*.example.com`  → exactly one extra label
 *  - `**.example.com` → one or more extra labels (also matches the bare domain? no — Next.js
 *    treats `**.example.com` as "any subdomain", we mirror that and additionally
 *    accept the apex to be forgiving with CDNs that serve from the apex).
 * @param {string} hostname
 * @param {string} pattern
 */
export function hostMatchesPattern(hostname, pattern) {
  const h = hostname.toLowerCase();
  const p = pattern.toLowerCase();
  if (p.startsWith('**.')) {
    const apex = p.slice(3);
    return h === apex || h.endsWith(`.${apex}`);
  }
  if (p.startsWith('*.')) {
    const apex = p.slice(2);
    if (!h.endsWith(`.${apex}`)) return false;
    const sub = h.slice(0, -(apex.length + 1));
    return sub.length > 0 && !sub.includes('.');
  }
  return h === p;
}

/**
 * Can `src` be served through the Next.js image optimizer?
 * Relative URLs (local uploads) always can; remote URLs must be https and
 * match the allow-list.
 * @param {string} src
 * @param {readonly string[]} hosts
 */
export function isOptimizableImageSrc(src, hosts) {
  if (!src) return false;
  if (src.startsWith('/') && !src.startsWith('//')) return true;
  let url;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return hosts.some((p) => hostMatchesPattern(url.hostname, p));
}

/** `remotePatterns` entries for next.config.mjs. */
export function toRemotePatterns(hosts) {
  return hosts.map((hostname) => ({ protocol: 'https', hostname }));
}

/**
 * Runtime view of the allow-list. `NEXT_PUBLIC_IMAGE_REMOTE_HOSTS` is written
 * by next.config.mjs from `resolveImageRemoteHosts`, so server components,
 * client components and the optimizer config all agree. When the variable is
 * absent (unit tests, scripts) we resolve from the process environment.
 * @returns {readonly string[]}
 */
export function imageRemoteHosts() {
  const inlined = process.env.NEXT_PUBLIC_IMAGE_REMOTE_HOSTS;
  if (inlined !== undefined) {
    return inlined
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
  }
  return resolveImageRemoteHosts(process.env);
}

/**
 * True when `src` may be routed through `/_next/image`.
 * @param {string} src
 */
export function canOptimizeImage(src) {
  return isOptimizableImageSrc(src, imageRemoteHosts());
}
