import { apiRoute, jsonOk, notFound, conflict } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { kickJobRunner } from '@/lib/jobs/queue';
import { auditLog } from '@/lib/audit';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) throw notFound('Job not found');
    if (job.status === 'RUNNING') throw conflict('Job is currently running');
    if (job.type === 'CANCEL_SUPPLIER_ORDER') {
      throw conflict(
        'Supplier cancellations cannot be retried from job logs. Verify the supplier outcome and resolve it in Supplier orders.'
      );
    }

    const reset = await prisma.job.updateMany({
      where: { id, status: { not: 'RUNNING' } },
      data: {
        status: 'PENDING',
        attempts: 0,
        nextRunAt: new Date(),
        lockedAt: null,
        claimToken: null,
        lastError: null,
      },
    });
    if (reset.count !== 1) throw conflict('Job was claimed while retry was being requested.');
    kickJobRunner();
    await auditLog({
      actor: { id: admin.id, email: admin.email },
      action: 'job.retried',
      entityType: 'Job',
      entityId: id,
      req,
    });
    return jsonOk({ requeued: true });
  })(req, ctx);
}
