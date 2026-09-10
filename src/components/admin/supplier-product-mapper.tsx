'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { Alert } from '@/components/ui/feedback';
import { TableWrap, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

/** Pricing explanation returned by the map endpoint (see applyEnginePricingToProduct). */
interface PricingSummary {
  oldPricePaise: number;
  newPricePaise: number;
  applied: boolean;
  minSafePricePaise: number;
  maxSafeDiscountPaise: number;
  marginPercent: number;
  estimatedNetProfitPaise: number;
  ruleName: string | null;
  ruleScope: string | null;
  warnings: string[];
}

export interface SupplierProductRow {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierSku: string;
  externalId: string | null;
  supplierCost: number; // ₹
  supplierShippingCost: number | null; // ₹
  stockQty: number | null;
  inStock: boolean | null;
  isActive: boolean;
  lastSyncedAt: string | null;
  productId: string | null;
  productName: string | null;
  productSlug: string | null;
}

const fmt = (d: string | null) =>
  d
    ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(d)
      )
    : 'never';

export function SupplierProductMapper({
  initial,
  products,
  showSupplierColumn = false,
}: {
  initial: SupplierProductRow[];
  products: Array<{ id: string; name: string; supplierSku: string | null }>;
  showSupplierColumn?: boolean;
}) {
  const router = useRouter();
  const [rows] = useState(initial);
  const [filter, setFilter] = useState<'ALL' | 'UNMAPPED' | 'MAPPED'>('ALL');
  const [search, setSearch] = useState('');
  const [mapping, setMapping] = useState<SupplierProductRow | null>(null);
  const [targetProduct, setTargetProduct] = useState('');
  const [costOverride, setCostOverride] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPricing, setLastPricing] = useState<PricingSummary | null>(null);

  const visible = useMemo(() => {
    let list = rows;
    if (filter === 'UNMAPPED') list = list.filter((r) => !r.productId);
    if (filter === 'MAPPED') list = list.filter((r) => Boolean(r.productId));
    if (search.trim()) {
      const t = search.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.supplierSku.toLowerCase().includes(t) ||
          r.supplierName.toLowerCase().includes(t) ||
          (r.productName ?? '').toLowerCase().includes(t)
      );
    }
    return list.slice(0, 200);
  }, [rows, filter, search]);

  function openMap(r: SupplierProductRow) {
    setMapping(r);
    // Suggest a product with the same supplier SKU
    const suggestion = products.find((p) => p.supplierSku && p.supplierSku === r.supplierSku);
    setTargetProduct(r.productId ?? suggestion?.id ?? '');
    setCostOverride('');
    setError(null);
  }

  async function saveMapping(unmap: boolean) {
    if (!mapping) return;
    setBusy(true);
    setError(null);
    try {
      const data = await apiFetch<{ pricing: PricingSummary | null }>(
        `/api/admin/supplier-products/${mapping.id}/map`,
        {
          body: {
            productId: unmap ? null : targetProduct || null,
            ...(costOverride.trim() !== '' && !unmap ? { supplierCost: Number(costOverride) } : {}),
          },
        }
      );
      if (!unmap && data?.pricing) {
        setLastPricing(data.pricing);
        toast(
          data.pricing.applied
            ? `Mapped — selling price updated to ₹${(data.pricing.newPricePaise / 100).toFixed(2)} by the pricing engine`
            : 'Mapped — selling price re-verified by the pricing engine (unchanged)',
          'success'
        );
      } else {
        setLastPricing(null);
        toast(unmap ? 'Mapping removed' : 'Mapped — supplier cost synced onto the product', 'success');
      }
      setMapping(null);
      router.refresh();
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : 'Mapping failed';
      setError(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {lastPricing && (
        <div
          className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 text-sm"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-emerald-900">Pricing engine result after mapping</p>
            <button
              type="button"
              className="text-xs text-gray-500 hover:text-gray-700"
              onClick={() => setLastPricing(null)}
            >
              dismiss
            </button>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-gray-500">Previous price</dt>
              <dd className="tabular-nums">₹{(lastPricing.oldPricePaise / 100).toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">New price</dt>
              <dd className="font-semibold tabular-nums">
                ₹{(lastPricing.newPricePaise / 100).toFixed(2)}
                {lastPricing.applied ? '' : ' (unchanged)'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Gross margin</dt>
              <dd className="tabular-nums">{lastPricing.marginPercent.toFixed(2)}%</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Min safe price</dt>
              <dd className="tabular-nums">₹{(lastPricing.minSafePricePaise / 100).toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Max safe discount</dt>
              <dd className="tabular-nums">₹{(lastPricing.maxSafeDiscountPaise / 100).toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Rule applied</dt>
              <dd>
                {lastPricing.ruleName ?? 'product defaults'}
                {lastPricing.ruleScope ? ` (${lastPricing.ruleScope})` : ''}
              </dd>
            </div>
          </dl>
          {lastPricing.warnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-amber-700">
              {lastPricing.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-gray-500">
            Gross margin — not net profit (payment fees and other costs are estimated inside the
            engine breakdown). Deterministic result; the minimum-margin floor is never reduced
            silently.
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search SKU / product…"
          className="input-base w-full max-w-xs"
          aria-label="Search supplier catalog"
        />
        <div className="flex gap-1.5" role="group" aria-label="Filter mapping state">
          {(['UNMAPPED', 'MAPPED', 'ALL'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                filter === f
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
              }`}
            >
              {f === 'ALL' ? 'All' : f === 'UNMAPPED' ? 'Unmapped' : 'Mapped'}
            </button>
          ))}
        </div>
        <p className="ml-auto text-xs tabular-nums text-gray-400">
          {visible.length} shown{rows.length > 200 ? ` (of ${rows.length})` : ''}
        </p>
      </div>

      {rows.length === 0 ? (
        <Alert tone="info">
          The supplier catalog is empty. For HTTP_REST suppliers use <strong>Sync catalog</strong>;
          for manual suppliers add products directly and set their supplier SKU on the product form.
        </Alert>
      ) : (
        <TableWrap>
          <table className="table-base">
            <thead className="bg-gray-50">
              <tr>
                <Th>Supplier SKU</Th>
                {showSupplierColumn && <Th className="hidden md:table-cell">Supplier</Th>}
                <Th>Cost</Th>
                <Th className="hidden sm:table-cell">Stock</Th>
                <Th className="hidden lg:table-cell">Last sync</Th>
                <Th>Mapped product</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((r) => (
                <tr
                  key={r.id}
                  className={
                    r.productId ? 'hover:bg-gray-50/60' : 'bg-amber-50/30 hover:bg-amber-50/60'
                  }
                >
                  <Td>
                    <p className="font-mono text-xs font-semibold text-gray-900">{r.supplierSku}</p>
                    {r.externalId && (
                      <p className="text-[10px] text-gray-400">ext: {r.externalId}</p>
                    )}
                  </Td>
                  {showSupplierColumn && (
                    <Td className="hidden text-xs text-gray-600 md:table-cell">{r.supplierName}</Td>
                  )}
                  <Td className="tabular-nums">
                    ₹{r.supplierCost.toLocaleString('en-IN')}
                    {r.supplierShippingCost != null && (
                      <span className="block text-[10px] text-gray-400">
                        +₹{r.supplierShippingCost.toLocaleString('en-IN')} ship
                      </span>
                    )}
                  </Td>
                  <Td className="hidden text-xs sm:table-cell">
                    {r.stockQty != null ? (
                      <span
                        className={
                          r.stockQty === 0
                            ? 'font-semibold text-red-600'
                            : 'tabular-nums text-gray-700'
                        }
                      >
                        {r.stockQty}
                      </span>
                    ) : r.inStock != null ? (
                      <Badge tone={r.inStock ? 'green' : 'red'}>
                        {r.inStock ? 'in stock' : 'out'}
                      </Badge>
                    ) : (
                      <span className="text-gray-300">unknown</span>
                    )}
                  </Td>
                  <Td className="hidden text-[11px] text-gray-400 lg:table-cell">
                    {fmt(r.lastSyncedAt)}
                  </Td>
                  <Td>
                    {r.productId && r.productName ? (
                      <Link
                        href={`/admin/products/${r.productId}`}
                        className="text-xs font-medium text-brand-700 hover:underline"
                      >
                        {r.productName}
                      </Link>
                    ) : (
                      <Badge tone="amber">unmapped</Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    <button
                      type="button"
                      onClick={() => openMap(r)}
                      className="text-xs font-medium text-brand-700 hover:underline"
                    >
                      {r.productId ? 'Change map' : 'Map →'}
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      <Modal
        open={mapping !== null}
        onClose={() => setMapping(null)}
        title={`Map supplier SKU ${mapping?.supplierSku ?? ''}`}
        wide
        footer={
          <div className="flex flex-wrap justify-between gap-2">
            <div>
              {mapping?.productId && (
                <Button variant="outline" onClick={() => saveMapping(true)} loading={busy}>
                  Unmap
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setMapping(null)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => saveMapping(false)} loading={busy} disabled={!targetProduct}>
                Save mapping
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Alert tone="info">
            Mapping links this supplier SKU to a catalog product so orders automatically carry the
            right supplier + cost, and stock updates flow through. On save, the supplier cost (and
            supplier shipping when known) is copied onto the product — its selling price recomputes
            through the pricing engine. One product can only map to one supplier entry.
          </Alert>
          <Field
            label="Catalog product"
            required
            hint="Products already mapped elsewhere are rejected by the server"
          >
            {(p) => (
              <Select
                {...p}
                value={targetProduct}
                onChange={(e) => setTargetProduct(e.target.value)}
              >
                <option value="">Select a product…</option>
                {products.map((p2) => (
                  <option key={p2.id} value={p2.id}>
                    {p2.name}
                    {p2.supplierSku ? ` (${p2.supplierSku})` : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Cost override (₹)"
            hint={`Blank keeps the synced cost (₹${mapping?.supplierCost.toLocaleString('en-IN') ?? '?'})`}
          >
            {(p) => (
              <Input
                {...p}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={costOverride}
                onChange={(e) => setCostOverride(e.target.value)}
                placeholder="optional"
              />
            )}
          </Field>
          <p className="text-xs text-gray-400">
            Need a brand-new catalog product for this SKU? Create it under{' '}
            <Link href="/admin/products/new" className="link-primary">
              Products → New
            </Link>
            , set the same supplier SKU, then map it here.
          </p>
        </div>
      </Modal>
    </div>
  );
}
