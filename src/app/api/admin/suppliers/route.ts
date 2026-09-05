import { apiRoute, jsonOk, badRequest, conflict } from '@/lib/errors';
import { supplierInputSchema } from '@/lib/validation/schemas';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { slugify, safeJsonParse } from '@/lib/utils';
import { auditLog } from '@/lib/audit';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

function parseSupplierConfig(
  raw: string | null | undefined
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (!raw || !raw.trim()) return Prisma.DbNull;
  const parsed = safeJsonParse<Record<string, unknown> | null>(raw, null);
  if (!parsed) throw badRequest('Supplier config must be valid JSON');
  return parsed as Prisma.InputJsonValue;
}

export const POST = apiRoute(async (req: Request) => {
  const admin = await requireAdmin();
  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = supplierInputSchema.parse(raw);

  if (body.type === 'HTTP_REST' && !body.baseUrl) {
    throw badRequest('HTTP_REST suppliers require a base URL');
  }

  const slug = slugify(body.slug || body.name);
  const clash = await prisma.supplier.findUnique({ where: { slug } });
  if (clash) throw conflict(`A supplier with slug "${slug}" already exists`);

  const supplier = await prisma.supplier.create({
    data: {
      name: body.name,
      slug,
      type: body.type,
      contactEmail: body.contactEmail || null,
      contactPhone: body.contactPhone || null,
      baseUrl: body.baseUrl || null,
      apiKeyEnvVar: body.apiKeyEnvVar || null,
      apiSecretEnvVar: body.apiSecretEnvVar || null,
      config: parseSupplierConfig(body.config),
      leadTimeDays: body.leadTimeDays ?? 3,
      isActive: body.isActive ?? true,
      notes: body.notes || null,
    },
  });
  await auditLog({
    actor: { id: admin.id, email: admin.email },
    action: 'supplier.created',
    entityType: 'Supplier',
    entityId: supplier.id,
    data: { type: supplier.type, slug },
    req,
  });
  return jsonOk({ supplier }, { status: 201 });
});
