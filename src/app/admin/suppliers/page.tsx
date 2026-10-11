import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { diagnoseSupplierAdapter } from '@/lib/suppliers/registry';
import { SupplierManager } from '@/components/admin/supplier-manager';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Suppliers — Admin', robots: { index: false } };

export default async function AdminSuppliersPage() {
  const suppliers = await prisma.supplier.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: {
      _count: { select: { products: true, supplierProducts: true, supplierOrders: true } },
      supplierProducts: {
        orderBy: { lastSyncedAt: 'desc' },
        take: 1,
        select: { lastSyncedAt: true },
      },
    },
  });

  const vercelEnv = process.env.VERCEL_ENV?.trim() || null;
  const gitBranch = process.env.VERCEL_GIT_COMMIT_REF?.trim() || null;

  return (
    <div className="space-y-5">
      <header>
        <h1>Suppliers</h1>
        <p className="mt-1 text-sm text-ink-400">
          Fulfilment sources for your catalog. Automated suppliers (CJ Dropshipping / HTTP REST)
          create supplier orders the moment payment is verified; manual suppliers appear on the
          order for you to fulfil. Secrets stay in server env vars — only variable <em>names</em>{' '}
          are stored here.
        </p>
      </header>
      <SupplierManager
        initial={suppliers.map((s) => {
          const diag = diagnoseSupplierAdapter(s);
          const envVarName = s.apiKeyEnvVar?.trim() || null;
          const envVal = envVarName ? process.env[envVarName] : undefined;
          const envPresent = typeof envVal === 'string' && envVal.trim().length > 0;
          return {
            id: s.id,
            name: s.name,
            slug: s.slug,
            type: s.type,
            contactEmail: s.contactEmail,
            contactPhone: s.contactPhone,
            baseUrl: s.baseUrl,
            apiKeyEnvVar: s.apiKeyEnvVar,
            apiSecretEnvVar: s.apiSecretEnvVar,
            configText: s.config != null ? JSON.stringify(s.config, null, 2) : '',
            leadTimeDays: s.leadTimeDays,
            isActive: s.isActive,
            notes: s.notes,
            productCount: s._count.products,
            supplierProductCount: s._count.supplierProducts,
            supplierOrderCount: s._count.supplierOrders,
            lastSyncedAt: s.supplierProducts[0]?.lastSyncedAt?.toISOString() ?? null,
            configured: diag.ok,
            adapterError: diag.error,
            envPresent,
            vercelEnv,
            gitBranch,
          };
        })}
      />
    </div>
  );
}
