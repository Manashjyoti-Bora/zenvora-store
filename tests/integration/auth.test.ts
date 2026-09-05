import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { registerUser, loginUser, requestPasswordReset, resetPassword } from '@/lib/auth/service';
import { ApiError } from '@/lib/errors';
import { SESSION_COOKIE } from '@/lib/auth/session';
import { clearCookieJar } from './mock-headers';
import { cleanupTestData, testEmail, TEST_DOMAIN } from './fixtures';

const jar = () =>
  (globalThis as unknown as { __cookieJar: Map<string, { value: string }> }).__cookieJar;

describe('authentication service', () => {
  beforeAll(async () => {
    await cleanupTestData();
  });
  afterAll(async () => {
    await cleanupTestData();
  });

  it('registers a user with a bcrypt hash (never plaintext) and opens a session', async () => {
    clearCookieJar();
    const email = testEmail('reg');
    const password = 'Str0ng!Passphrase';
    const result = await registerUser({ email, password, name: 'Reg Test' });

    expect(result.user.email).toBe(email);
    expect(result.user.role).toBe('CUSTOMER');

    const row = await prisma.user.findUnique({ where: { email } });
    expect(row).not.toBeNull();
    expect(row!.passwordHash).not.toContain(password);
    expect(row!.passwordHash.startsWith('$2')).toBe(true);

    // session cookie was set through the (mocked) cookie store
    expect(jar().get(SESSION_COOKIE)).toBeDefined();
    const sessions = await prisma.session.count({ where: { userId: row!.id } });
    expect(sessions).toBe(1);
  }, 20_000);

  it('rejects duplicate registration without revealing which credential failed login', async () => {
    const email = testEmail('dup');
    await registerUser({ email, password: 'Str0ng!Passphrase', name: 'Dup Test' });
    await expect(
      registerUser({ email, password: 'Other!Passphrase1', name: 'Dup Test' })
    ).rejects.toThrow(/already exists/i);
  }, 20_000);

  it('logs in with correct credentials and records lastLoginAt', async () => {
    clearCookieJar();
    const email = testEmail('login');
    await registerUser({ email, password: 'Str0ng!Passphrase', name: 'Login Test' });
    const before = await prisma.user.findUnique({ where: { email } });

    const result = await loginUser({ email, password: 'Str0ng!Passphrase' });
    expect(result.user.email).toBe(email);

    const after = await prisma.user.findUnique({ where: { email } });
    expect(after!.lastLoginAt).not.toBeNull();
    expect(after!.lastLoginAt!.getTime()).toBeGreaterThanOrEqual(
      before!.lastLoginAt?.getTime() ?? 0
    );
  }, 20_000);

  it('rejects wrong passwords with a 401 and generic message', async () => {
    const email = testEmail('wrongpw');
    await registerUser({ email, password: 'Str0ng!Passphrase', name: 'Wrong PW' });
    try {
      await loginUser({ email, password: 'Wrong!Passphrase1' });
      expect.unreachable('login should have failed');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).statusCode).toBe(401);
      // generic message — must not reveal whether the email exists or the password was wrong
      expect((err as ApiError).message).toBe('Invalid email or password.');
    }
  }, 20_000);

  it('blocks disabled accounts with a 403', async () => {
    const email = testEmail('disabled');
    await registerUser({ email, password: 'Str0ng!Passphrase', name: 'Disabled Test' });
    await prisma.user.update({ where: { email }, data: { status: 'DISABLED' } });
    try {
      await loginUser({ email, password: 'Str0ng!Passphrase' });
      expect.unreachable('login should have been blocked');
    } catch (err) {
      expect((err as ApiError).statusCode).toBe(403);
    }
  }, 20_000);

  it('full password-reset flow: token is single-use and rotates the password', async () => {
    const email = testEmail('reset');
    const oldPassword = 'Str0ng!Passphrase';
    const newPassword = 'Brand!New12345';
    await registerUser({ email, password: oldPassword, name: 'Reset Test' });

    await requestPasswordReset({ email });

    // The reset link is delivered through the notification queue; in tests the
    // rendered body contains the raw token (console provider, nothing sent).
    const ntf = await prisma.notification.findFirst({
      where: { email, template: 'PASSWORD_RESET' },
      orderBy: { createdAt: 'desc' },
    });
    expect(ntf).not.toBeNull();
    const match =
      ntf!.bodyHtml?.match(/token=([a-f0-9]{64})/) ?? ntf!.bodyText?.match(/token=([a-f0-9]{64})/);
    expect(match).not.toBeNull();
    const token = match![1];

    // the DB stores only the hash of the token
    const stored = await prisma.passwordResetToken.findFirst({ where: { userId: ntf!.userId! } });
    expect(stored!.tokenHash).not.toBe(token);

    await resetPassword({ token, password: newPassword });

    await expect(loginUser({ email, password: newPassword })).resolves.toBeDefined();
    await expect(loginUser({ email, password: oldPassword })).rejects.toThrow();

    // single-use: replaying the same token fails
    await expect(resetPassword({ token, password: 'An0ther!Pass1' })).rejects.toThrow(
      /invalid or has expired/i
    );
  }, 30_000);

  it('password reset for unknown emails succeeds silently (no user enumeration)', async () => {
    const result = await requestPasswordReset({ email: `nobody-${Date.now()}${TEST_DOMAIN}` });
    expect(result).toEqual({ requested: true });
  });
});
