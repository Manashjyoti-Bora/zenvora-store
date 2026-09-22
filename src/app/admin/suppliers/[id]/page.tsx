import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { diagnoseSupplierAdapter } from '@/lib/suppliers/registry';
import { Badge } from '@/components/ui/badge';
import { Card, Alert } from '@/components/ui/feedback';
import {
  SupplierProductMapper,
  type SupplierProductRow,
} from '@/components/admin/supplier-product-mapper';
import { SupplierSyncButton } from '@/components/admin/supplier-sync-button';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Supplier — Admin', robots: { index: false } };

type Ctx = { params: Promise<{ id: string }> };

export default async function SupplierDetailPage({ params }: Ctx) {
  const { id } = await params;
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: {
      _count: { select: { products: true, supplierProducts: true, supplierOrders: true } },
      supplierProducts: {
        orderBy: [{ productId: 'asc' }, { supplierSku: 'asc' }],
        take: 500,
        include: { product: { select: { name: true, slug: true } } },
      },
    },
  });
  if (!supplier) notFound();

  const products = await prisma.product.findMany({
    where: { status: { not: 'ARCHIVED' } },
    orderBy: { name: 'asc' },
    take: 500,
    select: { id: true, name: true, supplierSku: true },
  });

  const rows: SupplierProductRow[] = supplier.supplierProducts.map((sp) => ({
    id: sp.id,
    supplierId: sp.supplierId,
    supplierName: supplier.name,
    supplierSku: sp.supplierSku,
    externalId: sp.externalId,
    supplierCost: Number(sp.supplierCost),
    supplierShippingCost: sp.supplierShippingCost != null ? Number(sp.supplierShippingCost) : null,
    stockQty: sp.stockQty,
    inStock: sp.inStock,
    isActive: sp.isActive,
    lastSyncedAt: sp.lastSyncedAt?.toISOString() ?? null,
    productId: sp.productId,
    productName: sp.product?.name ?? null,
    productSlug: sp.product?.slug ?? null,
  }));

  const supportsSync =
    supplier.type === 'HTTP_REST' || supplier.type === 'CJ' || supplier.type === 'DEMO';

  // Server-side configuration diagnostics (never exposes secret values).
  const diag = diagnoseSupplierAdapter(supplier);
  const envValue = supplier.apiKeyEnvVar ? process.env[supplier.apiKeyEnvVar] : undefined;
  const envPresent = typeof envValue === 'string' && envValue.length > 0;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/admin/suppliers"
            className="text-xs font-medium text-brand-700 hover:underline"
          >
            ← All suppliers
          </Link>
          <h1 className="mt-1">{supplier.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <Badge
              tone={
                supplier.type === 'HTTP_REST' || supplier.type === 'CJ'
                  ? 'blue'
                  : supplier.type === 'DEMO'
                    ? 'purple'
                    : 'gray'
              }
            >
              {supplier.type.replace('_', ' ')}
            </Badge>
            <Badge tone={supplier.isActive ? 'green' : 'gray'}>
              {supplier.isActive ? 'Active' : 'Inactive'}
            </Badge>
            {supplier.baseUrl && <span className="font-mono text-xs">{supplier.baseUrl}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <SupplierSyncButton
            supplierId={supplier.id}
            supportsSync={supportsSync}
            type={supplier.type}
          />
          <Link
            href="/admin/suppliers"
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Edit in list
          </Link>
        </div>
      </header>

      {supplier.type === 'DEMO' && (
        <Alert tone="warning" title="Demo supplier">
          This supplier runs the built-in simulator: it accepts orders, &ldquo;ships&rdquo; them on
          a schedule and reports tracking — everything is clearly marked as demo data. Use it to
          test the full automation pipeline without a real partner.
        </Alert>
      )}
      {supplier.type === 'MANUAL' && (
        <Alert tone="info" title="Manual fulfilment">
          Orders containing this supplier&apos;s products create a supplier order for you to fulfil
          yourself: source/ship the item, then record the shipment (carrier + tracking) from the
          order page so the customer gets updates.
        </Alert>
      )}
      {supplier.type === 'CJ' && (
        <Alert tone="info" title="CJ Dropshipping automation">
          Paid orders forward automatically through CJ&apos;s official API v2 (CJ wallet balance
          is debited per order — keep it topped up). Tracking arrives via webhook-triggered,
          authenticated re-syncs plus scheduled polling; CJ webhooks are never trusted directly.
          Cancellations/returns are manual steps in the CJ dashboard. Setup: docs/SUPPLIER_API.md
          (CJ section).
        </Alert>
      )}
      {supplier.type === 'HTTP_REST' && (
        <Alert tone="info" title="HTTP REST automation">
          Endpoint configuration lives in the supplier&apos;s JSON config (env var names hold the
          secrets). Contract documentation: <code>docs/SUPPLIER_API.md</code>. Failed calls retry
          with backoff via the job queue; every attempt is logged (sanitised) on the supplier order.
        </Alert>
      )}

      {diag.ok && supplier.apiKeyEnvVar && envPresent && (
        <Alert tone="success" title="API configuration OK">
          Environment variable <code>{supplier.apiKeyEnvVar}</code> is present in this environment
          (value never displayed). Catalog sync and automatic forwarding are enabled.
        </Alert>
      )}
      {!diag.ok && (
        <Alert tone="error" title="Automation blocked — configuration problem">
          <p>{diag.error}</p>
          <p className="mt-2">
            Fix this in Vercel → Settings → Environment Variables for the affected scope, then
            redeploy (variables are only read at deploy time). Until fixed, catalog sync fails and
            affected orders fall back to the manual queue — nothing pretends to be automated.
          </p>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">Mapped products</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{supplier._count.products}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">Catalog entries</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{supplier._count.supplierProducts}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">Supplier orders</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{supplier._count.supplierOrders}</p>
          <Link
            href={`/admin/supplier-orders?supplier=${supplier.id}`}
            className="text-xs text-brand-700 hover:underline"
          >
            View →
          </Link>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">Lead time</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{supplier.leadTimeDays}d</p>
        </Card>
      </div>

      <section aria-labelledby="catalog-mapping">
        <h2 id="catalog-mapping" className="mb-3 text-lg font-semibold text-gray-900">
          Catalog &amp; mapping
        </h2>
        <SupplierProductMapper initial={rows} products={products} />
      </section>
    </div>
  );
}
