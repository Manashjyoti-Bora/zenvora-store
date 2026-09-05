import './env';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';

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
