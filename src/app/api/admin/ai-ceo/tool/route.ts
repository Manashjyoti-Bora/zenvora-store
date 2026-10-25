import { z } from 'zod';
import { apiRoute, jsonOk, ApiError, badRequest, forbidden } from '@/lib/errors';
import { requireStaff } from '@/lib/auth/guards';
import { permissionLevelOf } from '@/lib/auth/permissions';
import { readJson } from '@/lib/http';
import { auditLog } from '@/lib/audit';
import { loadAiCeoSnapshotSafe } from '@/lib/ai-ceo/snapshot';
import { runTool } from '@/lib/ai-ceo/tools';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    tool: z.string().min(1).max(64),
    input: z.record(z.unknown()).optional(),
  })
  .strict();

/**
 * POST /api/admin/ai-ceo/tool
 *
 * Runs one typed, read-only business tool. Authorisation is resolved on the
 * server from the session (never from the request body), and the tool itself
 * re-checks the minimum permission level before parsing input.
 */
export const POST = apiRoute(async (req: Request) => {
  const user = await requireStaff();
  const raw = await readJson(req);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) throw badRequest('Expected { tool: string, input?: object }.');

  const loaded = await loadAiCeoSnapshotSafe();
  if (!loaded.ok) throw new ApiError(503, loaded.error, 'STORE_DATA_UNAVAILABLE');

  const result = runTool({
    name: parsed.data.tool,
    input: parsed.data.input ?? {},
    snapshot: loaded.snapshot,
    level: permissionLevelOf(user),
  });

  await auditLog({
    actor: { id: user.id, email: user.email },
    action: 'ai_ceo.tool',
    entityType: 'ai_ceo_tool',
    entityId: parsed.data.tool,
    data: { tool: parsed.data.tool, ok: result.ok, ...(result.ok ? {} : { code: result.code }) },
    req,
  });

  if (!result.ok) {
    if (result.code === 'FORBIDDEN') throw forbidden(result.message);
    throw new ApiError(400, result.message, result.code, result.issues);
  }
  return jsonOk(result, { headers: { 'cache-control': 'no-store' } });
});
