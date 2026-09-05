import { apiRoute, jsonOk, badRequest, unauthorized } from '@/lib/errors';
import { changePasswordSchema } from '@/lib/validation/schemas';
import { requireUser } from '@/lib/auth/guards';
import { verifyPassword, hashPassword, passwordPolicyIssues } from '@/lib/auth/password';
import { revokeAllUserSessions, createSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { auditLog } from '@/lib/audit';
import { assertRateLimit } from '@/lib/rate-limit';
import { clientIp, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(async (req: Request) => {
  const user = await requireUser();
  const ip = clientIp(req) ?? 'local';
  assertRateLimit(`change-pw:${user.id}`, { limit: 5, windowMs: 30 * 60_000 });
  void ip;

  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = changePasswordSchema.parse(raw);

  const record = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const valid = await verifyPassword(body.currentPassword, record.passwordHash);
  if (!valid) {
    await auditLog({
      actor: { id: user.id, email: user.email },
      action: 'account.password_change_failed',
      req,
    });
    throw unauthorized('Your current password is incorrect.');
  }
  const issues = passwordPolicyIssues(body.newPassword);
  if (issues.length > 0) throw badRequest(issues.join(' '));

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(body.newPassword) },
  });
  // Invalidate all sessions, then re-authenticate this device.
  await revokeAllUserSessions(user.id);
  await createSession(user.id, req);
  await auditLog({
    actor: { id: user.id, email: user.email },
    action: 'account.password_changed',
    req,
  });
  return jsonOk({ changed: true });
});
