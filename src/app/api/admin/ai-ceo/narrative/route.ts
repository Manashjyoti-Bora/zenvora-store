import { apiRoute, jsonOk, ApiError } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { readJson } from '@/lib/http';
import { buildAiCeoReport } from '@/lib/ai-ceo/engine';
import { loadAiCeoSnapshotSafe } from '@/lib/ai-ceo/snapshot';
import { generateAiCeoNarrative } from '@/lib/ai-ceo/narrative-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/admin/ai-ceo/narrative
 *
 * Optional, explicitly-invoked narrative summary. Returns 200 with
 * `{ ok: false, code, message }` when no provider/budget/permission is
 * available — that is an expected state, not an error, and the deterministic
 * report is unaffected.
 */
export const POST = apiRoute(async (req: Request) => {
  const admin = await requireAdmin();
  // Body is unused but must be valid JSON if sent; readJson also enforces the size cap.
  await readJson(req, { maxBytes: 2_000 });

  const loaded = await loadAiCeoSnapshotSafe();
  if (!loaded.ok) throw new ApiError(503, loaded.error, 'STORE_DATA_UNAVAILABLE');

  const report = buildAiCeoReport(loaded.snapshot);
  const narrative = await generateAiCeoNarrative(report, { actor: admin, req });

  return jsonOk(
    {
      ...narrative,
      label: narrative.ok ? 'AI narrative — unverified' : null,
      reportGeneratedAt: report.generatedAt,
    },
    { headers: { 'cache-control': 'no-store' } }
  );
});
