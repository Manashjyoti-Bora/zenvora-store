import { z } from 'zod';
import { apiRoute, badRequest, jsonOk } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { bulkProcessSupplierProducts } from '@/lib/catalog/auto-import';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bulkSchema = z.object({
  mode: z.enum(['EVALUATE_ONLY', 'IMPORT_ELIGIBLE_DRAFT', 'SAFE_PUBLISH_ELIGIBLE']),
  supplierProductIds: z.array(z.string()).max(200).optional(),
});

export const POST = apiRoute(async (req: Request) => {
  const admin = await requireAdmin();
  const raw = await req.json().catch(() => ({}));
  const parsed = bulkSchema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest('Invalid bulk supplier-product action', parsed.error.flatten());
  }

  const result = await bulkProcessSupplierProducts({
    mode: parsed.data.mode,
    supplierProductIds: parsed.data.supplierProductIds,
    actor: { id: admin.id, email: admin.email },
  });

  return jsonOk(result);
});
