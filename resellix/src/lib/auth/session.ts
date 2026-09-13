import { cookies } from 'next/headers';
import { prisma } from '../db';
import { env, isProduction } from '../env';
import { randomToken, sha256 } from '../crypto';
import type { Role, UserStatus } from '@prisma/client';

/**
 * Session management.
 *
 * - The raw session token exists ONLY in the httpOnly cookie.
 * - The database stores sha256(token), so a DB leak does not allow session
 *   hijacking.
 * - Cookies: httpOnly, SameSite=Lax, Secure in production, path=/.
 */

export const SESSION_COOKIE = 'resellix_session';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
}

function cookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    maxAge: maxAgeSec,
  } as const;
}

export async function createSession(
  userId: string,
  req?: Request
): Promise<{ token: string; sessionId: string }> {
  const token = randomToken(32);
  const ttlSec = env.SESSION_TTL_DAYS * 24 * 60 * 60;
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      userAgent: req?.headers.get('user-agent')?.slice(0, 300) ?? null,
      expiresAt: new Date(Date.now() + ttlSec * 1000),
    },
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, cookieOptions(ttlSec));
  return { token, sessionId: session.id };
}

export async function getSessionUser(): Promise<{ user: SessionUser; sessionId: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.revokedAt || session.expiresAt <= new Date()) {
    // Expired/revoked: clear the cookie lazily.
    cookieStore.delete(SESSION_COOKIE);
    return null;
  }
  if (session.user.status !== 'ACTIVE') {
    return null;
  }
  return {
    sessionId: session.id,
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      status: session.user.status,
    },
  };
}

export async function revokeCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  cookieStore.delete(SESSION_COOKIE);
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Delete expired sessions (housekeeping; called from cron/jobs runner). */
export async function purgeExpiredSessions(): Promise<number> {
  const res = await prisma.session.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { revokedAt: { lt: new Date(Date.now() - 7 * 864e5) } },
      ],
    },
  });
  return res.count;
}
