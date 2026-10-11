import { apiRoute, jsonOk, badRequest } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { readJson } from '@/lib/http';
import { publishSupplierProduct } from '@/lib/catalog/publish';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Publish a synced supplier catalog entry as a real catalog product.
 *
 * Admin-only (this is a catalog write, not a read). Defaults to DRAFT; going
 * straight to ACTIVE requires an explicit name + description, and every path
 * runs through the validated `saveProduct` pipeline (cost/price guards,
 * pricing engine, audit log).
 */
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;

    const raw = await readJson(req);
    const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

    const status = body.status === undefined ? 'DRAFT' : body.status;
    if (status !== 'DRAFT' && status !== 'ACTIVE') {
      throw badRequest('status must be DRAFT or ACTIVE');
    }
    const percentMarkup =
      body.percentMarkup === undefined || body.percentMarkup === null || body.percentMarkup === ''
        ? null
        : Number(body.percentMarkup);
    if (percentMarkup !== null && (!Number.isFinite(percentMarkup) || percentMarkup < 0)) {
      throw badRequest('percentMarkup must be a non-negative number');
    }

    const result = await publishSupplierProduct({
      supplierProductId: id,
      actor: { id: admin.id, email: admin.email },
      status,
      name: typeof body.name === 'string' ? body.name : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
      shortDescription:
        typeof body.shortDescription === 'string' ? body.shortDescription : undefined,
      categoryId:
        typeof body.categoryId === 'string' && body.categoryId.length > 0 ? body.categoryId : null,
      percentMarkup,
    });

    return jsonOk(result, { status: 201 });
  })(req, ctx);
}
