import { apiRoute, jsonOk, badRequest } from '@/lib/errors';
import { updateProfileSchema } from '@/lib/validation/schemas';
import { requireUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { auditLog } from '@/lib/audit';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const PATCH = apiRoute(async (req: Request) => {
  const user = await requireUser();
  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = updateProfileSchema.parse(raw);

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { name: body.name, phone: body.phone || null },
  });
  await auditLog({
    actor: { id: user.id, email: user.email },
    action: 'account.profile_updated',
    entityType: 'User',
    entityId: user.id,
    req,
  });
  return jsonOk({ name: updated.name, phone: updated.phone, email: updated.email });
});
