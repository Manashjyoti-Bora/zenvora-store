import { apiRoute, jsonOk, notFound, badRequest } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { diagnoseSupplierAdapter, getSupplierAdapter } from '@/lib/suppliers/registry';
import { syncAndAutoProcessSupplier } from '@/lib/catalog/auto-import';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Pull the supplier catalog into supplier_products, run Indian reselling
 * eligibility & ranking evaluation, and optionally auto-import / auto-publish
 * eligible products through quality gates.
 */
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const supplier = await prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw notFound('Supplier not found');

    // Pre-flight: report the REAL configuration problem (never a secret value).
    const diag = diagnoseSupplierAdapter(supplier);
    if (!diag.ok) throw badRequest(`Supplier is misconfigured: ${diag.error}`);

    const adapter = getSupplierAdapter(supplier);
    if (!adapter.capabilities.catalogSync || (!adapter.getProducts && !adapter.discoverCatalog)) {
      throw badRequest(
        `Supplier type ${supplier.type} (${adapter.label}) does not support catalog sync. Add products manually or map supplier SKUs on the product form.`
      );
    }

    let body: Record<string, unknown> = {};
    try {
      const text = await req.text();
      if (text.trim()) body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = {};
    }

    const report = await syncAndAutoProcessSupplier({
      supplierId: supplier.id,
      limit: typeof body.limit === 'number' ? body.limit : 200,
      includeGeneralCatalog: Boolean(body.includeGeneralCatalog),
      categoryId: typeof body.categoryId === 'string' ? body.categoryId : undefined,
      keyword: typeof body.keyword === 'string' ? body.keyword : undefined,
      enrichDetails: Boolean(body.enrichDetails),
      verifyIndiaFreight: Boolean(body.verifyIndiaFreight),
      autoImport: typeof body.autoImport === 'boolean' ? body.autoImport : false,
      autoPublishEligible:
        typeof body.autoPublishEligible === 'boolean' ? body.autoPublishEligible : false,
      resumeFromCheckpoint: Boolean(body.resumeFromCheckpoint),
      actor: { id: admin.id, email: admin.email },
    });

    const hints: string[] = [];
    if (report.totals.discovered === 0) {
      hints.push(
        'Supplier returned 0 products — add products in the CJ dashboard (My Products) or enable General Catalog discovery, then sync again.'
      );
    }
    if (report.totals.skippedNoCost > 0) {
      hints.push(
        `${report.totals.skippedNoCost} item(s) skipped: supplier did not return a buyable cost.`
      );
    }
    if (report.totals.autoImported > 0) {
      hints.push(
        `Auto-imported ${report.totals.autoImported} product(s) (${report.totals.autoPublished} published, ${report.totals.savedAsDraft} saved as draft/needs review).`
      );
    }

    return jsonOk({
      synced: report.totals.created + report.totals.updated > 0,
      created: report.totals.created,
      updated: report.totals.updated,
      total: report.totals.discovered,
      skippedNoCost: report.totals.skippedNoCost,
      skippedInvalidCost: 0,
      skippedNoSku: report.totals.skippedNoSku,
      report,
      message: hints.length > 0 ? hints.join(' ') : undefined,
    });
  })(req, ctx);
}
