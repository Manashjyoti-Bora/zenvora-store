import { apiRoute, jsonOk, notFound, badRequest } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { diagnoseSupplierAdapter, CJDropshippingAdapter } from '@/lib/suppliers/registry';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Production-safe CJ forensic probe (admin-only, POST because it performs
 * real (read-only) calls against CJ's API).
 *
 * Runs three steps — credential exchange, minimal authenticated endpoint
 * (setting/get, which also reads CJ's own account-authorization view), and
 * the exact catalog endpoint (product/myProduct/query) — and returns ONLY
 * safe structured data: codes, flags, requestIds, timings and sha256
 * fingerprints. NEVER the API key or any token value. No logout, no retries:
 * running the probe never invalidates the currently-working token.
 *
 * Purpose: prove whether a catalog-sync failure is Zenvora-side
 * (configuration) or CJ-side (credential/authorization), and produce the
 * requestId evidence CJ support asks for.
 */
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    await requireAdmin();
    const { id } = await ctx.params;
    const supplier = await prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw notFound('Supplier not found');
    if (supplier.type !== 'CJ') {
      throw badRequest(`Supplier ${supplier.name} is of type ${supplier.type}, not CJ.`);
    }

    // Configuration gate first: a record/env problem is Zenvora-side and the
    // probe cannot even run without the credential.
    const diag = diagnoseSupplierAdapter(supplier);
    if (!diag.ok || !supplier.apiKeyEnvVar) {
      return jsonOk({
        zenvoraSide: true,
        configured: false,
        adapterError: diag.error,
        conclusion:
          'Zenvora-side configuration problem (see adapterError). Fix this before probing CJ.',
      });
    }

    const adapter = new CJDropshippingAdapter(supplier);
    const probe = await adapter.probe();
    return jsonOk({
      zenvoraSide: false,
      configured: true,
      apiKeyEnvVar: supplier.apiKeyEnvVar,
      ...probe,
    });
  })(req, ctx);
}
