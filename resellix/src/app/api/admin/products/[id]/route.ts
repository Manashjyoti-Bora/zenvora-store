import { apiRoute, jsonOk, badRequest, notFound } from '@/lib/errors';
import { productInputSchema } from '@/lib/validation/schemas';
import { requireAdmin } from '@/lib/auth/guards';
import { saveProduct, archiveProduct, deleteProduct } from '@/lib/catalog/products';
import { prisma } from '@/lib/db';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(
    async () => {
      await requireAdmin();
      const { id } = await ctx.params;
      const product = await prisma.product.findUnique({
        where: { id },
        include: {
          images: { orderBy: { position: 'asc' } },
          variants: { orderBy: { sortOrder: 'asc' } },
          category: true,
          supplier: true,
        },
      });
      if (!product) throw notFound('Product not found');
      return jsonOk({ product });
    },
    { csrf: false }
  )(req, ctx);
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) throw notFound('Product not found');

    const raw = await readJson(req);
    if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
    const body = productInputSchema.parse({ ...raw, id });

    const result = await saveProduct(body, { id: admin.id, email: admin.email });
    return jsonOk(result);
  })(req, ctx);
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const url = new URL(req.url);
    if (url.searchParams.get('hard') === '1') {
      await deleteProduct(id, { id: admin.id, email: admin.email });
      return jsonOk({ deleted: true });
    }
    await archiveProduct(id, { id: admin.id, email: admin.email });
    return jsonOk({ archived: true });
  })(req, ctx);
}
