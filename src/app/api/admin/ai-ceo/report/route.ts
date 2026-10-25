import { z } from 'zod';
import { apiRoute, jsonOk, ApiError } from '@/lib/errors';
import { requireStaff } from '@/lib/auth/guards';
import { buildAiCeoReport } from '@/lib/ai-ceo/engine';
import { loadAiCeoSnapshotSafe } from '@/lib/ai-ceo/snapshot';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(365).optional(),
});

/**
 * GET /api/admin/ai-ceo/report?windowDays=30
 *
 * Deterministic executive report for the signed-in staff/admin session. Every
 * figure comes from the database snapshot taken for this request; nothing is
 * cached, sampled or estimated beyond the labelled evidence basis.
 */
export const GET = apiRoute(
  async (req: Request) => {
    await requireStaff();
    const url = new URL(req.url);
    const parsed = querySchema.safeParse({ windowDays: url.searchParams.get('windowDays') ?? undefined });
    if (!parsed.success) {
      throw new ApiError(400, 'windowDays must be an integer between 1 and 365.', 'BAD_REQUEST');
    }

    const loaded = await loadAiCeoSnapshotSafe(
      parsed.data.windowDays ? { windowDays: parsed.data.windowDays } : {}
    );
    if (!loaded.ok) {
      throw new ApiError(503, loaded.error, 'STORE_DATA_UNAVAILABLE');
    }

    const report = buildAiCeoReport(loaded.snapshot);
    return jsonOk(report, { headers: { 'cache-control': 'no-store' } });
  },
  { csrf: false }
);
