import { apiRoute, jsonOk, badRequest } from '@/lib/errors';
import { addressSchema } from '@/lib/validation/schemas';
import { requireUser } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { assertRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(
  async () => {
    const user = await requireUser();
    const addresses = await prisma.address.findMany({
      where: { userId: user.id },
      orderBy: [{ isDefaultShipping: 'desc' }, { createdAt: 'desc' }],
    });
    return jsonOk({ addresses });
  },
  { csrf: false }
);

export const POST = apiRoute(async (req: Request) => {
  const user = await requireUser();
  assertRateLimit(`addr:${user.id}`, { limit: 20, windowMs: 15 * 60_000 });

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = addressSchema.parse(raw);

  const existingCount = await prisma.address.count({ where: { userId: user.id } });
  const makeDefault = body.isDefaultShipping || existingCount === 0;

  const address = await prisma.$transaction(async (tx) => {
    if (makeDefault) {
      await tx.address.updateMany({
        where: { userId: user.id },
        data: { isDefaultShipping: false, isDefaultBilling: false },
      });
    }
    return tx.address.create({
      data: {
        userId: user.id,
        label: body.label || null,
        fullName: body.fullName,
        phone: body.phone,
        line1: body.line1,
        line2: body.line2 || null,
        city: body.city,
        state: body.state,
        postalCode: body.postalCode,
        country: body.country,
        isDefaultShipping: makeDefault,
        isDefaultBilling: makeDefault,
      },
    });
  });
  return jsonOk({ address }, { status: 201 });
});
