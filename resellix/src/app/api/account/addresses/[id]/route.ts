import { apiRoute, jsonOk, badRequest, notFound, forbidden } from '@/lib/errors';
import { addressSchema } from '@/lib/validation/schemas';
import { requireUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function loadOwnedAddress(id: string, userId: string) {
  const address = await prisma.address.findUnique({ where: { id } });
  if (!address) throw notFound('Address not found');
  if (address.userId !== userId) throw forbidden();
  return address;
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  return apiRoute(async () => {
    const { id } = await ctx.params;
    const user = await requireUser();
    const existing = await loadOwnedAddress(id, user.id);

    const raw = await req.json().catch(() => null);
    if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
    const body = addressSchema.partial().parse(raw);

    const address = await prisma.$transaction(async (tx) => {
      if (body.isDefaultShipping) {
        await tx.address.updateMany({
          where: { userId: user.id },
          data: { isDefaultShipping: false, isDefaultBilling: false },
        });
      }
      return tx.address.update({
        where: { id: existing.id },
        data: {
          label: body.label !== undefined ? body.label || null : existing.label,
          fullName: body.fullName ?? existing.fullName,
          phone: body.phone ?? existing.phone,
          line1: body.line1 ?? existing.line1,
          line2: body.line2 !== undefined ? body.line2 || null : existing.line2,
          city: body.city ?? existing.city,
          state: body.state ?? existing.state,
          postalCode: body.postalCode ?? existing.postalCode,
          country: body.country ?? existing.country,
          isDefaultShipping: body.isDefaultShipping ?? existing.isDefaultShipping,
          isDefaultBilling: body.isDefaultShipping ?? existing.isDefaultBilling,
        },
      });
    });
    return jsonOk({ address });
  })(req, ctx);
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  return apiRoute(async () => {
    const { id } = await ctx.params;
    const user = await requireUser();
    const existing = await loadOwnedAddress(id, user.id);
    await prisma.address.delete({ where: { id: existing.id } });
    return jsonOk({ deleted: true });
  })(req, ctx);
}
