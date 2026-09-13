import { apiRoute, jsonOk, badRequest, notFound } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const statusSchema = z.object({ status: z.enum(['NEW', 'READ', 'RESOLVED']) });

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    await requireAdmin();
    const { id } = await ctx.params;
    const existing = await prisma.contactMessage.findUnique({ where: { id } });
    if (!existing) throw notFound('Message not found');

    const raw = await readJson(req);
    if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
    const body = statusSchema.parse(raw);

    const message = await prisma.contactMessage.update({
      where: { id },
      data: { status: body.status },
    });
    return jsonOk({ message });
  })(req, ctx);
}
