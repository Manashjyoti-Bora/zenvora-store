import { apiRoute, jsonOk } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { processDueJobs } from '@/lib/jobs/runner';
import { auditLog } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = apiRoute(async (req: Request) => {
  const admin = await requireAdmin();
  const stats = await processDueJobs({ limit: 25 });
  await auditLog({
    actor: { id: admin.id, email: admin.email },
    action: 'jobs.manual_run',
    data: stats as unknown as Record<string, unknown>,
    req,
  });
  return jsonOk(stats);
});
