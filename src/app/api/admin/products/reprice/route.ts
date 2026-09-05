import { apiRoute, jsonOk, badRequest } from '@/lib/errors';
import { repriceSchema } from '@/lib/validation/schemas';
import { requireAdmin } from '@/lib/auth/guards';
import { repriceProducts } from '@/lib/catalog/products';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = apiRoute(async (req: Request) => {
  const admin = await requireAdmin();
  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = repriceSchema.parse(raw);

  const result = await repriceProducts({
    scope: body.scope,
    categoryId: body.categoryId ?? null,
    supplierId: body.supplierId ?? null,
    apply: body.apply,
    actor: { id: admin.id, email: admin.email },
  });
  return jsonOk(result);
});
