import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Edge middleware:
 *  1. Issues the double-submit CSRF cookie when missing (readable by
 *     same-origin JS; echoed back in x-csrf-token on unsafe requests and
 *     verified server-side in apiRoute).
 *  2. Fast UX redirects for /account and /admin when there is no session
 *     cookie. NOTE: this is convenience only - real authentication and role
 *     authorization are enforced server-side in every layout and API route.
 */

const CSRF_COOKIE = 'resellix_csrf';
const SESSION_COOKIE = 'resellix_session';

export function middleware(req: NextRequest): NextResponse {
  // Expose the pathname to server components (root layout hides the
  // storefront chrome inside the admin area).
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-pathname', req.nextUrl.pathname);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  const { pathname } = req.nextUrl;

  if (!req.cookies.get(CSRF_COOKIE)?.value) {
    const token = `${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
    res.cookies.set(CSRF_COOKIE, token, {
      httpOnly: false, // JS must read it for the double-submit header
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  if (!hasSession && (pathname.startsWith('/account') || pathname.startsWith('/admin'))) {
    const loginUrl = new URL('/auth/login', req.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return res;
}

export const config = {
  // Everything except static assets and uploaded files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|uploads/).*)'],
};
