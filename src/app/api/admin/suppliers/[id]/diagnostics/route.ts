import { apiRoute, jsonOk, notFound } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { diagnoseSupplierAdapter } from '@/lib/suppliers/registry';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Safe supplier configuration diagnostics for the admin UI.
 *
 * Reports whether the supplier's integration adapter can construct in THIS
 * environment and - for API-key suppliers - whether the named environment
 * variable is present. NEVER returns the variable's value, only its name and
 * a boolean. Use it to distinguish:
 *   - record problem   (apiKeyEnvVar not set on the supplier row)
 *   - runtime problem  (variable absent/empty in the deployed environment,
 *                       e.g. added in Vercel after the last deploy)
 *   - healthy          (configured === true)
 */
export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    await requireAdmin();
    const { id } = await ctx.params;
    const supplier = await prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw notFound('Supplier not found');

    const diag = diagnoseSupplierAdapter(supplier);

    let valuePresent = false;
    if (supplier.apiKeyEnvVar) {
      const value = process.env[supplier.apiKeyEnvVar];
      valuePresent = typeof value === 'string' && value.length > 0;
    }

    return jsonOk({
      supplierId: supplier.id,
      name: supplier.name,
      type: supplier.type,
      isActive: supplier.isActive,
      configured: diag.ok,
      adapterError: diag.error,
      // Name of the env var only - the secret itself is never readable here.
      apiKeyEnvVar: supplier.apiKeyEnvVar,
      valuePresent,
    });
  })(req, ctx);
}
