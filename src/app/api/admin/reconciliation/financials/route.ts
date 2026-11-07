import { apiRoute, badRequest, jsonOk } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { inspectFinancialReconciliation } from '@/lib/admin/financial-reconciliation';

export const dynamic = 'force-dynamic';

/** Admin-only, bounded, read-only financial consistency scan. */
export const GET = apiRoute(async (req: Request) => {
  await requireAdmin();
  const url = new URL(req.url);
  const rawTake = url.searchParams.get('take');
  const requestedTake = rawTake == null ? 250 : Number(rawTake);
  if (!Number.isInteger(requestedTake) || requestedTake < 1 || requestedTake > 1_000) {
    throw badRequest('take must be an integer between 1 and 1000.');
  }
  const rawStaleMinutes = url.searchParams.get('staleMinutes');
  const staleMinutes = rawStaleMinutes == null ? 30 : Number(rawStaleMinutes);
  if (!Number.isInteger(staleMinutes) || staleMinutes < 1 || staleMinutes > 43_200) {
    throw badRequest('staleMinutes must be an integer between 1 and 43200.');
  }

  const findings = await inspectFinancialReconciliation({
    take: requestedTake,
    staleAfterMs: staleMinutes * 60_000,
  });
  return jsonOk({
    readOnly: true,
    scanLimit: requestedTake,
    staleAfterMinutes: staleMinutes,
    findingCount: findings.length,
    findings,
  });
});
