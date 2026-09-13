import { apiRoute, jsonOk, badRequest, notFound, conflict } from '@/lib/errors';
import { supplierInputSchema } from '@/lib/validation/schemas';
import { requireAdmin } from '@/lib/auth/guards';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { slugify, safeJsonParse } from '@/lib/utils';
import { auditLog } from '@/lib/audit';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const existing = await prisma.supplier.findUnique({ where: { id } });
    if (!existing) throw notFound('Supplier not found');

    const raw = await readJson(req);
    if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
    const body = supplierInputSchema.partial().parse(raw);

    const slug =
      body.slug !== undefined || body.name !== undefined
        ? slugify(body.slug || body.name || existing.name)
        : existing.slug;
    if (slug !== existing.slug) {
      const clash = await prisma.supplier.findUnique({ where: { slug } });
      if (clash && clash.id !== id) throw conflict(`Slug "${slug}" is already in use`);
    }
    let config: Prisma.InputJsonValue | typeof Prisma.DbNull | undefined;
    if (body.config !== undefined) {
      if (!body.config || !body.config.trim()) {
        config = Prisma.DbNull;
      } else {
        const parsed = safeJsonParse<Record<string, unknown> | null>(body.config, null);
        if (!parsed) throw badRequest('Supplier config must be valid JSON');
        config = parsed as Prisma.InputJsonValue;
      }
    }

    const supplier = await prisma.supplier.update({
      where: { id },
      data: {
        name: body.name ?? existing.name,
        slug,
        type: body.type ?? existing.type,
        contactEmail:
          body.contactEmail !== undefined ? body.contactEmail || null : existing.contactEmail,
        contactPhone:
          body.contactPhone !== undefined ? body.contactPhone || null : existing.contactPhone,
        baseUrl: body.baseUrl !== undefined ? body.baseUrl || null : existing.baseUrl,
        apiKeyEnvVar:
          body.apiKeyEnvVar !== undefined ? body.apiKeyEnvVar || null : existing.apiKeyEnvVar,
        apiSecretEnvVar:
          body.apiSecretEnvVar !== undefined
            ? body.apiSecretEnvVar || null
            : existing.apiSecretEnvVar,
        ...(config !== undefined ? { config } : {}),
        leadTimeDays: body.leadTimeDays ?? existing.leadTimeDays,
        isActive: body.isActive ?? existing.isActive,
        notes: body.notes !== undefined ? body.notes || null : existing.notes,
      },
    });
    await auditLog({
      actor: { id: admin.id, email: admin.email },
      action: 'supplier.updated',
      entityType: 'Supplier',
      entityId: id,
      req,
    });
    return jsonOk({ supplier });
  })(req, ctx);
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return apiRoute(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const supplier = await prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw notFound('Supplier not found');
    if (supplier.slug === 'manual-fulfilment') {
      throw conflict('The built-in manual fulfilment supplier cannot be deleted.');
    }
    const orderCount = await prisma.supplierOrder.count({ where: { supplierId: id } });
    if (orderCount > 0) {
      // Never delete history: deactivate instead.
      await prisma.supplier.update({ where: { id }, data: { isActive: false } });
      await auditLog({
        actor: { id: admin.id, email: admin.email },
        action: 'supplier.deactivated',
        entityType: 'Supplier',
        entityId: id,
        data: { reason: `${orderCount} supplier orders reference it` },
        req,
      });
      return jsonOk({ deactivated: true, supplierOrders: orderCount });
    }
    await prisma.supplier.delete({ where: { id } });
    await auditLog({
      actor: { id: admin.id, email: admin.email },
      action: 'supplier.deleted',
      entityType: 'Supplier',
      entityId: id,
      req,
    });
    return jsonOk({ deleted: true });
  })(req, ctx);
}
