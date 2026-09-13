import { apiRoute, jsonOk, badRequest } from '@/lib/errors';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Inventory history for the audit trail (Admin → Inventory). */
export const GET = apiRoute(async (req: Request) => {
  await requireAdmin();
  const url = new URL(req.url);
  const productId = url.searchParams.get('productId');
  if (!productId) throw badRequest('productId query parameter is required');
  const movements = await prisma.inventoryMovement.findMany({
    where: { productId },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { order: { select: { orderNumber: true } } },
  });
  return jsonOk({ movements });
});
