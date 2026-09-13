import { apiRoute, jsonOk, badRequest, notFound, conflict } from '@/lib/errors';
import { userRoleUpdateSchema } from '@/lib/validation/schemas';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { auditLog } from '@/lib/audit';
import { revokeAllUserSessions } from '@/lib/auth/session';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw notFound('User not found');

    const raw = await readJson(req);
    if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
    const body = userRoleUpdateSchema.parse({ ...raw, userId: id });

    // Privilege-escalation / lockout protection: an admin cannot demote or
    // disable their own account through this endpoint.
    if (target.id === admin.id && (body.role !== 'ADMIN' || body.status === 'DISABLED')) {
      throw conflict('You cannot demote or disable your own account.');
    }
    const adminCount = await prisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } });
    if (target.role === 'ADMIN' && body.role !== 'ADMIN' && adminCount <= 1) {
      throw conflict('At least one active admin must remain.');
    }

    const user = await prisma.user.update({
      where: { id },
      data: { role: body.role, ...(body.status ? { status: body.status } : {}) },
    });
    if (body.status === 'DISABLED' || user.role !== target.role) {
      await revokeAllUserSessions(user.id);
    }
    await auditLog({
      actor: { id: admin.id, email: admin.email },
      action: 'admin.user_updated',
      entityType: 'User',
      entityId: id,
      data: { role: user.role, status: user.status, previousRole: target.role },
      req,
    });
    return jsonOk({
      user: { id: user.id, email: user.email, role: user.role, status: user.status },
    });
  })(req, ctx);
}
