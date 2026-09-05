import { cookies } from 'next/headers';
import { safeEqual } from './crypto';
import { ApiError } from './errors';

/**
 * CSRF protection: double-submit cookie pattern.
 *
 * - `middleware.ts` sets a non-httpOnly `resellix_csrf` cookie (random token).
 * - Browser JS (only same-origin code can read it) must echo the value in the
 *   `x-csrf-token` header on every unsafe request.
 * - Session cookies are SameSite=Lax, which already blocks classic cross-site
 *   POST forgery; the double-submit token is defence in depth (it also covers
 *   same-site subdomain attackers and Lax top-level-navigation edge cases).
 *
 * Endpoints authenticated by webhook signature or shared secret (payments
 * webhook, supplier webhook, cron) are exempt and MUST verify their own
 * credentials server-side.
 */

export const CSRF_COOKIE = 'resellix_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export async function verifyCsrfFromRequest(req: Request): Promise<void> {
  const headerToken = req.headers.get(CSRF_HEADER);
  const cookieStore = await cookies();
  const cookieToken = cookieStore.get(CSRF_COOKIE)?.value;

  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    throw new ApiError(
      403,
      'Your session could not be verified for this action. Please refresh the page and try again.',
      'CSRF_FAILED'
    );
  }
}
