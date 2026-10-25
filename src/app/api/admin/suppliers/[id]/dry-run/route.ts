import { apiRoute, jsonOk, notFound } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { buildSupplierDryRunReport } from '@/lib/catalog/dry-run';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/suppliers/:id/dry-run?mode=IMPORT_ELIGIBLE_DRAFT|SAFE_PUBLISH_ELIGIBLE&limit=200
 *
 * Read-only preview of what the catalogue pipeline would do with this
 * supplier's discovered rows (lifecycle, tier, demand confidence,
 * contribution margin, rejection/hold reasons). Performs no writes — see
 * buildSupplierDryRunReport. ADMIN only.
 */
export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    await requireAdmin();
    const { id } = await ctx.params;
    const supplier = await prisma.supplier.findUnique({ where: { id }, select: { id: true } });
    if (!supplier) throw notFound('Supplier not found');

    const url = new URL(req.url);
    const modeParam = url.searchParams.get('mode');
    const mode = modeParam === 'SAFE_PUBLISH_ELIGIBLE' ? 'SAFE_PUBLISH_ELIGIBLE' : 'IMPORT_ELIGIBLE_DRAFT';
    const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '200', 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 200;

    const report = await buildSupplierDryRunReport({ supplierId: id, mode, limit });
    return jsonOk(report, { headers: { 'cache-control': 'no-store' } });
  })(req, ctx);
}
