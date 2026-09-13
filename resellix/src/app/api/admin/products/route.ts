import { apiRoute, jsonOk, badRequest } from '@/lib/errors';
import { productInputSchema } from '@/lib/validation/schemas';
import { requireAdmin } from '@/lib/auth/guards';
import { saveProduct } from '@/lib/catalog/products';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(async (req: Request) => {
  const admin = await requireAdmin();
  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = productInputSchema.parse(raw);
  delete (body as { id?: string }).id; // creation only

  const result = await saveProduct(body, { id: admin.id, email: admin.email });
  return jsonOk(result, { status: 201 });
});
