import { apiRoute, jsonOk, badRequest, conflict } from '@/lib/errors';
import { categoryInputSchema } from '@/lib/validation/schemas';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { slugify } from '@/lib/utils';
import { auditLog } from '@/lib/audit';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(async (req: Request) => {
  const admin = await requireAdmin();
  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = categoryInputSchema.parse(raw);

  const slug = slugify(body.slug || body.name);
  if (!slug) throw badRequest('Could not derive a slug from the category name');
  const existing = await prisma.category.findUnique({ where: { slug } });
  if (existing) throw conflict(`A category with slug "${slug}" already exists`);

  const category = await prisma.category.create({
    data: {
      name: body.name,
      slug,
      description: body.description || null,
      parentId: body.parentId || null,
      sortOrder: body.sortOrder ?? 0,
      isActive: body.isActive ?? true,
      seoTitle: body.seoTitle || null,
      seoDescription: body.seoDescription || null,
    },
  });
  await auditLog({
    actor: { id: admin.id, email: admin.email },
    action: 'category.created',
    entityType: 'Category',
    entityId: category.id,
    req,
  });
  return jsonOk({ category }, { status: 201 });
});
