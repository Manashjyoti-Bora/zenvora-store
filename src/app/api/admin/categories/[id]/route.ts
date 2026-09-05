import { apiRoute, jsonOk, badRequest, notFound, conflict } from '@/lib/errors';
import { categoryInputSchema } from '@/lib/validation/schemas';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { slugify } from '@/lib/utils';
import { auditLog } from '@/lib/audit';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) throw notFound('Category not found');

    const raw = await readJson(req);
    if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
    const body = categoryInputSchema.partial().parse(raw);

    const slug =
      body.slug !== undefined || body.name !== undefined
        ? slugify(body.slug || body.name || existing.name)
        : existing.slug;
    if (slug !== existing.slug) {
      const clash = await prisma.category.findUnique({ where: { slug } });
      if (clash && clash.id !== id) throw conflict(`Slug "${slug}" is already in use`);
    }

    const category = await prisma.category.update({
      where: { id },
      data: {
        name: body.name ?? existing.name,
        slug,
        description:
          body.description !== undefined ? body.description || null : existing.description,
        parentId: body.parentId !== undefined ? body.parentId || null : existing.parentId,
        sortOrder: body.sortOrder ?? existing.sortOrder,
        isActive: body.isActive ?? existing.isActive,
        seoTitle: body.seoTitle !== undefined ? body.seoTitle || null : existing.seoTitle,
        seoDescription:
          body.seoDescription !== undefined ? body.seoDescription || null : existing.seoDescription,
      },
    });
    await auditLog({
      actor: { id: admin.id, email: admin.email },
      action: 'category.updated',
      entityType: 'Category',
      entityId: id,
      req,
    });
    return jsonOk({ category });
  })(req, ctx);
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const productCount = await prisma.product.count({ where: { categoryId: id } });
    if (productCount > 0) {
      throw conflict(
        `This category still has ${productCount} product(s). Move them to another category first (their category would be unset otherwise).`
      );
    }
    await prisma.category.delete({ where: { id } });
    await auditLog({
      actor: { id: admin.id, email: admin.email },
      action: 'category.deleted',
      entityType: 'Category',
      entityId: id,
      req,
    });
    return jsonOk({ deleted: true });
  })(req, ctx);
}
