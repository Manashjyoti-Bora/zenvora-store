import './env';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { SESSION_COOKIE } from '@/lib/auth/session';
import { randomToken, sha256 } from '@/lib/crypto';

import { HttpAgent, uniqueEmail, type E2EResponse } from './http';

/**
 * DB-level user fixtures.
 *
 * Registration over HTTP is rate-limited to 5 / 15 min / IP (a deliberate
 * production-hardening limit). The E2E suite must live inside the same budgets
 * a real client would face, so only the tests that specifically exercise the
 * /api/auth/register endpoint register over HTTP (4 calls). Every other spec
 * creates its users here — straight into the dev DB with the app's own
 * password hasher — and then LOGS IN over HTTP, which is what those specs are
 * actually testing.
 */

export const FIXTURE_PASSWORD = 'E2e!Pass1234';

export interface FixtureUser {
  id: string;
  email: string;
  password: string;
}

export async function createFixtureUser(
  prefix: string,
  role: 'CUSTOMER' | 'STAFF' | 'ADMIN' = 'CUSTOMER'
): Promise<FixtureUser> {
  const email = uniqueEmail(prefix);
  const user = await prisma.user.create({
    data: {
      email,
      name: `${prefix} fixture`,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
      role,
    },
  });
  return { id: user.id, email, password: FIXTURE_PASSWORD };
}

/** Prime CSRF cookie, then log in over HTTP. Returns the login response. */
export async function loginFixture(agent: HttpAgent, user: FixtureUser): Promise<E2EResponse> {
  await agent.get('/api/health');
  return agent.post('/api/auth/login', { email: user.email, password: user.password });
}

/**
 * A browser-like agent holding a REAL session row for `user`, minted straight
 * into the database (only sha256(token) is stored, exactly like the app does).
 *
 * Several specs verify authorization rather than login, and the public login
 * endpoint is deliberately rate-limited to 20 attempts / 15 min / IP — a budget
 * the suite must respect. Use this for post-login behaviour; use
 * `loginFixture` in the specs that actually exercise authentication.
 */
export async function createSessionAgent(user: FixtureUser): Promise<HttpAgent> {
  const token = randomToken(32);
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  const agent = new HttpAgent();
  agent.setCookie(SESSION_COOKIE, token);
  await agent.get('/api/health'); // primes the readable CSRF cookie
  return agent;
}

/** Mint a session for an existing account (e.g. the seeded admin) by e-mail. */
export async function sessionAgentForEmail(email: string): Promise<HttpAgent> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
  if (!user) throw new Error(`No user with e-mail ${email} — seed the database first`);
  return createSessionAgent({ id: user.id, email: user.email, password: '' });
}
