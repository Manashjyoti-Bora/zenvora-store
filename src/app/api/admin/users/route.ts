import { apiRoute, jsonOk, badRequest, conflict } from '@/lib/errors';
import { adminCreateUserSchema } from '@/lib/validation/schemas';
import { requireAdmin } from '@/lib/auth/guards';
import { hashPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db';
import { auditLog } from '@/lib/audit';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Create a staff/admin user (customer registration stays on /auth/register). */
export const POST = apiRoute(async (req: Request) => {
  const admin = await requireAdmin();
  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = adminCreateUserSchema.parse(raw);

  const existing = await prisma.user.findUnique({ where: { email: body.email } });
  if (existing) throw conflict('A user with this email already exists');

  const user = await prisma.user.create({
    data: {
      email: body.email,
      name: body.name,
      passwordHash: await hashPassword(body.password),
      role: body.role,
      status: 'ACTIVE',
    },
  });
  await auditLog({
    actor: { id: admin.id, email: admin.email },
    action: 'admin.user_created',
    entityType: 'User',
    entityId: user.id,
    data: { role: user.role },
    req,
  });
  return jsonOk(
    { user: { id: user.id, email: user.email, name: user.name, role: user.role } },
    { status: 201 }
  );
});
