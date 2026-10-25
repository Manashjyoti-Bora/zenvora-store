import { z } from 'zod';
import { apiRoute, jsonOk, ApiError, badRequest } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { readJson } from '@/lib/http';
import { executeAiCeoAction } from '@/lib/ai-ceo/action-executor';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z
  .object({
    actionKey: z.string().min(1).max(64),
    args: z.record(z.unknown()).optional(),
    idempotencyKey: z.string().min(8).max(128),
  })
  .strict();

const STATUS_BY_CODE: Record<string, number> = {
  UNKNOWN_ACTION: 400,
  INVALID_ARGS: 400,
  FORBIDDEN: 403,
  APPROVAL_REQUIRED: 403,
  KILL_SWITCH: 409,
  ACTIONS_DISABLED: 409,
  DUPLICATE: 409,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  DAILY_LIMIT: 429,
  EXECUTION_FAILED: 500,
};

/**
 * POST /api/admin/ai-ceo/action
 *
 * Executes one of the catalogue's Mode-2 actions. Deliberately ADMIN-only at
 * the route (the policy additionally requires the per-action level), and every
 * consequential action is refused here no matter who calls: publishing,
 * pricing, refunds and settings changes stay in their own admin screens.
 */
export const POST = apiRoute(async (req: Request) => {
  const admin = await requireAdmin();
  const raw = await readJson(req, { maxBytes: 20_000 });
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest('Expected { actionKey, args?, idempotencyKey }.', parsed.error.issues);
  }

  const result = await executeAiCeoAction({
    actionKey: parsed.data.actionKey,
    args: parsed.data.args ?? {},
    idempotencyKey: parsed.data.idempotencyKey,
    actor: admin,
    req,
  });

  if (!result.ok) {
    const status = STATUS_BY_CODE[result.code] ?? 400;
    throw new ApiError(status, result.message, result.code);
  }
  return jsonOk(result, { headers: { 'cache-control': 'no-store' } });
});
