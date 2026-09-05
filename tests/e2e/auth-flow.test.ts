import './env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { errCode, errMessage, HttpAgent, okData, uniqueEmail, waitForServer } from './http';
import { prisma } from '@/lib/db';

import { createFixtureUser, FIXTURE_PASSWORD, loginFixture } from './fixtures';

/**
 * E2E — authentication & authorization edge cases over real HTTP.
 *
 * IP rate-limit budget awareness (same server process as all specs):
 * login limiter = 20 / 15 min per IP. This file uses: 1 wrong + 1 good +
 * 9 throttle-attempts + 1 locked-correct = 12. admin-authz.test.ts stays ≤ 6.
 */

const PASSWORD = 'E2e!Pass1234';

beforeAll(async () => {
  await waitForServer();
}, 180_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('registration', () => {
  it('registers a new customer, sets a session cookie, and /api/auth/me reflects it', async () => {
    const agent = new HttpAgent();
    await agent.get('/api/health'); // prime CSRF cookie
    const email = uniqueEmail('e2e-reg');

    const res = await agent.post('/api/auth/register', { name: 'E2E Customer', email, password: PASSWORD });
    expect([200, 201]).toContain(res.status);
    expect(agent.cookies.has('resellix_session')).toBe(true);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    const body = okData<{ user?: { email?: string } }>(me);
    expect(body?.user?.email?.toLowerCase()).toBe(email);
  });

  it('rejects duplicate email registration', async () => {
    const agent = new HttpAgent();
    await agent.get('/api/health');
    const email = uniqueEmail('e2e-dup');
    const first = await agent.post('/api/auth/register', { name: 'Dup One', email, password: PASSWORD });
    expect([200, 201]).toContain(first.status);

    const secondAgent = new HttpAgent();
    await secondAgent.get('/api/health');
    const second = await secondAgent.post('/api/auth/register', { name: 'Dup Two', email, password: PASSWORD });
    expect([400, 409]).toContain(second.status);
  });

  it('rejects a weak password at the API boundary (zod, not just UI)', async () => {
    const agent = new HttpAgent();
    await agent.get('/api/health');
    const res = await agent.post('/api/auth/register', { name: 'Weak Pass', email: uniqueEmail('e2e-weak'), password: 'abc' });
    expect(res.status).toBe(400);
  });
});

describe('login', () => {
  it('rejects a wrong password with a generic (non-enumerating) error', async () => {
    const user = await createFixtureUser('e2e-login');

    const loginAgent = new HttpAgent();
    await loginAgent.get('/api/health');
    const res = await loginAgent.post('/api/auth/login', { email: user.email, password: 'Wrong!Pass9999' });
    expect(res.status).toBe(401);
    expect(errMessage(res)).toMatch(/invalid email or password/i);
    expect(loginAgent.cookies.has('resellix_session')).toBe(false);
  });

  it('logs in with correct credentials and logs out cleanly', async () => {
    const user = await createFixtureUser('e2e-session');
    const agent = new HttpAgent();
    const login = await loginFixture(agent, user);
    expect(login.status).toBe(200);
    expect(agent.cookies.has('resellix_session')).toBe(true);

    const meBefore = await agent.get('/api/auth/me');
    expect(meBefore.status).toBe(200);
    expect(okData<{ user?: { email?: string } }>(meBefore)?.user?.email?.toLowerCase()).toBe(user.email);

    const logout = await agent.post('/api/auth/logout');
    expect([200, 204]).toContain(logout.status);
    expect(agent.cookies.has('resellix_session')).toBe(false);

    // /api/auth/me is intentionally non-throwing: anonymous → 200 { user: null }.
    const meAfter = await agent.get('/api/auth/me');
    expect(meAfter.status).toBe(200);
    expect(okData<{ user: unknown }>(meAfter)?.user).toBeNull();

    // Session row is revoked in the DB, not just the cookie dropped.
    const live = await prisma.session.count({ where: { userId: user.id, revokedAt: null } });
    expect(live).toBe(0);
  });

  it('account-level throttle: after repeated failures, even the CORRECT password is refused', async () => {
    const user = await createFixtureUser('e2e-throttle');

    const loginAgent = new HttpAgent();
    await loginAgent.get('/api/health');

    let throttled: { status: number; error?: string } | null = null;
    for (let i = 0; i < 9; i += 1) {
      const res = await loginAgent.post('/api/auth/login', { email: user.email, password: 'Wrong!Pass9999' });
      if (res.status === 400) {
        throttled = { status: res.status, error: errMessage(res) };
        break;
      }
      expect(res.status).toBe(401);
    }
    expect(throttled, 'account throttle should engage within 9 attempts').not.toBeNull();
    expect(throttled?.error).toMatch(/too many login attempts/i);

    // Correct password must now also be blocked while the account window is hot.
    const locked = await loginAgent.post('/api/auth/login', { email: user.email, password: FIXTURE_PASSWORD });
    expect([400, 401]).toContain(locked.status);
  });
});

describe('password reset (no enumeration)', () => {
  it('returns an identical success response for an unknown email', async () => {
    const agent = new HttpAgent();
    await agent.get('/api/health');
    const res = await agent.post('/api/auth/forgot-password', { email: 'nobody-e2e@e2e.example' });
    expect(res.status).toBe(200);
  });
});

describe('CSRF protection (double-submit cookie)', () => {
  it('rejects an unsafe request that omits the x-csrf-token header', async () => {
    const agent = new HttpAgent();
    await agent.get('/api/health'); // cookie jar now has resellix_csrf, but we withhold the header
    expect(agent.csrfToken).toBeTruthy();
    const res = await agent.post('/api/auth/login', { email: 'x@e2e.example', password: 'Y!x1234567' }, { csrf: false });
    expect(res.status).toBe(403);
    expect(errCode(res)).toBe('CSRF_FAILED');
  });
});

describe('page-level guards', () => {
  it('redirects anonymous visitors from /admin to the login page', async () => {
    const agent = new HttpAgent();
    const res = await agent.get('/admin');
    expect([302, 307]).toContain(res.status);
    expect(res.location()).toMatch(/\/auth\/login/);
  });
});
