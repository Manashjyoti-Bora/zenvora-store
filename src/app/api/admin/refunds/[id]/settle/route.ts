import { apiRoute, jsonOk, badRequest, notFound } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { settleRefund } from '@/lib/payments/refunds';
import { z } from 'zod';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const settleSchema = z.object({
  status: z.enum(['COMPLETED', 'FAILED']),
  note: z.string().trim().max(300).optional().or(z.literal('')).nullable(),
});

/** Manual settlement for refunds the gateway could not process automatically. */
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const refund = await prisma.refund.findUnique({ where: { id } });
    if (!refund) throw notFound('Refund not found');

    const raw = await readJson(req);
    if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
    const body = settleSchema.parse(raw);

    await settleRefund({
      refundId: id,
      status: body.status,
      failureReason: body.status === 'FAILED' ? (body.note ?? 'Marked failed by admin') : undefined,
      actor: 'ADMIN',
      actorId: admin.id,
    });
    return jsonOk({ settled: body.status });
  })(req, ctx);
}
