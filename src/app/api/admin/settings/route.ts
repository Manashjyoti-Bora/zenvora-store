import { apiRoute, jsonOk, badRequest } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { getSettings, updateSettings, settingsPatchSchema } from '@/lib/settings';
import { auditLog } from '@/lib/audit';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(
  async () => {
    await requireAdmin();
    return jsonOk({ settings: await getSettings() });
  },
  { csrf: false }
);

export const PATCH = apiRoute(async (req: Request) => {
  const admin = await requireAdmin();
  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  // The fully merged candidate is validated against settingsSchema in
  // updateSettings; unknown patch keys are ignored by its guarded deep merge.
  const patch = settingsPatchSchema.parse(raw);
  const updated = await updateSettings(patch);
  await auditLog({
    actor: { id: admin.id, email: admin.email },
    action: 'settings.updated',
    entityType: 'Setting',
    entityId: 'store',
    data: Object.keys(patch) as unknown as Record<string, unknown>,
    req,
  });
  return jsonOk({ settings: updated });
});
