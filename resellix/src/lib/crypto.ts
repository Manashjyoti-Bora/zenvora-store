import crypto from 'node:crypto';

/**
 * Server-only crypto helpers (secure random, hashing, constant-time compare).
 * Kept OUT of utils.ts so client components can import cn()/slugify() without
 * pulling node:crypto into the browser bundle.
 */

/** Cryptographically secure random hex token. */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/** Unambiguous uppercase alphabet (no 0/O/1/I) for human-facing codes. */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function randomCode(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

/** Order numbers: RX-YYMMDD-XXXXXX (random suffix, collision-checked by caller). */
export function generateOrderNumber(now: Date = new Date()): string {
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `RX-${yy}${mm}${dd}-${randomCode(6)}`;
}

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Constant-time string comparison (for tokens/signatures). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against itself to keep timing uniform, then fail.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}
