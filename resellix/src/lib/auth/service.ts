import { prisma } from '../db';
import { env } from '../env';
import { conflict, forbidden, unauthorized, badRequest } from '../errors';
import { auditLog } from '../audit';
import { logger } from '../logger';
import { hashPassword, verifyPassword, passwordPolicyIssues } from './password';
import { createSession, revokeAllUserSessions } from './session';
import { randomToken, sha256 } from '../crypto';
import { queueNotification } from '../notifications/notify';

/**
 * Authentication service: register, login, logout, password reset.
 * All functions are server-only and enforce rate limiting at the API layer.
 */

export interface AuthResult {
  user: { id: string; email: string; name: string; role: string };
}

export async function registerUser(input: {
  email: string;
  password: string;
  name: string;
  phone?: string;
  req?: Request;
}): Promise<AuthResult> {
  const policyIssues = passwordPolicyIssues(input.password);
  if (policyIssues.length > 0) throw badRequest(policyIssues.join(' '));

  const email = input.email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Uniform error - do not reveal whether the email is registered.
    throw conflict('An account with this email already exists. Try logging in instead.');
  }

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      role: 'CUSTOMER',
    },
  });

  await createSession(user.id, input.req);
  await auditLog({
    actor: { id: user.id, email: user.email },
    action: 'auth.register',
    entityType: 'User',
    entityId: user.id,
    req: input.req,
  });
  await queueNotification({
    template: 'WELCOME',
    email: user.email,
    userId: user.id,
    vars: { name: user.name },
  });
  return { user: { id: user.id, email: user.email, name: user.name, role: user.role } };
}

export async function loginUser(input: {
  email: string;
  password: string;
  req?: Request;
}): Promise<AuthResult> {
  const email = input.email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email } });

  // Always run a bcrypt compare (even for unknown users) to reduce
  // user-enumeration via timing differences.
  const hash =
    user?.passwordHash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinval';
  const valid = await verifyPassword(input.password, hash);

  if (!user || !valid) {
    await auditLog({
      actor: { email },
      action: 'auth.login_failed',
      data: { reason: user ? 'wrong_password' : 'unknown_email' },
      req: input.req,
    });
    throw unauthorized('Invalid email or password.');
  }
  if (user.status !== 'ACTIVE') {
    await auditLog({ actor: { id: user.id, email }, action: 'auth.login_blocked', req: input.req });
    throw forbidden('This account has been disabled. Please contact support.');
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession(user.id, input.req);
  await auditLog({ actor: { id: user.id, email }, action: 'auth.login', req: input.req });
  return { user: { id: user.id, email: user.email, name: user.name, role: user.role } };
}

/**
 * Forgot password: always returns success (no user enumeration). The reset
 * link is sent by email; only the sha256 hash of the token is stored.
 */
export async function requestPasswordReset(input: {
  email: string;
  req?: Request;
}): Promise<{ requested: true }> {
  const email = input.email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.status === 'ACTIVE') {
    const token = randomToken(32);
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60_000),
      },
    });
    await queueNotification({
      template: 'PASSWORD_RESET',
      email: user.email,
      userId: user.id,
      vars: { name: user.name, resetUrl: `${env.APP_URL}/auth/reset-password?token=${token}` },
    });
    await auditLog({
      actor: { id: user.id, email },
      action: 'auth.password_reset_requested',
      req: input.req,
    });
  } else {
    logger.info('Password reset requested for unknown/inactive email', { email });
  }
  return { requested: true };
}

export async function resetPassword(input: {
  token: string;
  password: string;
  req?: Request;
}): Promise<{ reset: true }> {
  const policyIssues = passwordPolicyIssues(input.password);
  if (policyIssues.length > 0) throw badRequest(policyIssues.join(' '));

  const tokenHash = sha256(input.token);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  const genericError = badRequest('This password reset link is invalid or has expired.');
  if (!record || record.usedAt || record.expiresAt <= new Date()) throw genericError;

  const passwordHash = await hashPassword(input.password);
  await prisma.$transaction([
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
  ]);
  // A password change invalidates every existing session.
  await revokeAllUserSessions(record.userId);
  await auditLog({ actor: { id: record.userId }, action: 'auth.password_reset', req: input.req });
  return { reset: true };
}
