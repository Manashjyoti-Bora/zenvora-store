import { z } from 'zod';
import { apiRoute, jsonOk, badRequest } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { getSettings, updateSettings } from '@/lib/settings';
import { readJson } from '@/lib/http';
import { auditLog } from '@/lib/audit';
import { AI_CEO_ACTIONS } from '@/lib/ai-ceo/actions';

export const dynamic = 'force-dynamic';

const patchSchema = z
  .object({
    enabled: z.boolean().optional(),
    actionsEnabled: z.boolean().optional(),
    dailyActionLimit: z.number().int().min(0).max(200).optional(),
    providerNarrativeEnabled: z.boolean().optional(),
    monthlyTokenBudget: z.number().int().min(0).max(2_000_000).optional(),
  })
  .strict();

/**
 * PATCH /api/admin/ai-ceo/config
 *
 * The AI CEO's own kill switch and limits. This endpoint can only change the
 * automation posture — it cannot publish, price, refund or enable payments, so
 * it is not a back door around the owner-only rules elsewhere. Every change is
 * audited with the previous and new values.
 */
export const PATCH = apiRoute(async (req: Request) => {
  const admin = await requireAdmin();
  const raw = await readJson(req, { maxBytes: 5_000 });
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest('Unknown or invalid AI CEO setting.', parsed.error.issues);
  }
  if (Object.keys(parsed.data).length === 0) {
    throw badRequest('No changes supplied.');
  }

  const before = (await getSettings()).aiCeo;
  const updated = (await updateSettings({ aiCeo: parsed.data })).aiCeo;

  await auditLog({
    actor: { id: admin.id, email: admin.email },
    action: 'ai_ceo.config.updated',
    entityType: 'Setting',
    entityId: 'store.aiCeo',
    data: { before, after: updated },
    req,
  });

  return jsonOk({ aiCeo: updated });
});

/** GET returns the current posture without exposing provider secrets. */
export const GET = apiRoute(
  async () => {
    await requireAdmin();
    const settings = await getSettings();
    return jsonOk({
      aiCeo: settings.aiCeo,
      executableActions: Object.values(AI_CEO_ACTIONS)
        .filter((a) => a.execution === 'ALLOWED')
        .map((a) => ({ key: a.key, label: a.label, minLevel: a.minLevel, sideEffects: a.sideEffects, maxPerDay: a.maxPerDay })),
    });
  },
  { csrf: false }
);
