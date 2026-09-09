'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export interface InventoryRow {
  productId: string;
  name: string;
  slug: string;
  status: string;
  stockMode: string;
  hasVariants: boolean;
  variants: Array<{ id: string; name: string; stock: number; isActive: boolean }>;
  stock: number;
  lowStockThreshold: number;
}

function stockTone(stock: number, threshold = 5) {
  if (stock === 0) return 'text-red-600 font-bold';
  if (threshold > 0 && stock <= threshold) return 'text-amber-600 font-semibold';
  return 'text-gray-800';
}

export function InventoryEditor({ initial }: { initial: InventoryRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function saveThreshold(productId: string, lowStockThreshold: number) {
    setSavingId(`thr-${productId}`);
    try {
      await apiFetch('/api/admin/inventory', {
        method: 'PATCH',
        body: { productId, lowStockThreshold },
      });
      toast('Low-stock threshold updated', 'success');
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Could not update threshold', 'error');
    } finally {
      setSavingId(null);
    }
  }

  async function saveStock(productId: string, variantId: string | null, stock: number) {
    const key = variantId ?? productId;
    setSavingId(key);
    try {
      await apiFetch('/api/admin/inventory', {
        method: 'PATCH',
        body: { productId, variantId, stock },
      });
      toast('Stock updated', 'success');
      setRows((prev) =>
        prev.map((r) =>
          r.productId === productId
            ? variantId
              ? {
                  ...r,
                  variants: r.variants.map((v) => (v.id === variantId ? { ...v, stock } : v)),
                }
              : { ...r, stock }
            : r
        )
      );
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Could not update stock', 'error');
    } finally {
      setSavingId(null);
    }
  }

  async function toggleStatus(row: InventoryRow) {
    const next = row.status === 'ACTIVE' ? 'DRAFT' : 'ACTIVE';
    setSavingId(row.productId);
    try {
      await apiFetch('/api/admin/inventory', {
        method: 'PATCH',
        body: { productId: row.productId, status: next },
      });
      toast(next === 'ACTIVE' ? 'Product published' : 'Product unpublished (draft)', 'success');
      setRows((prev) =>
        prev.map((r) => (r.productId === row.productId ? { ...r, status: next } : r))
      );
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Could not update status', 'error');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <ul className="space-y-3">
      {rows.length === 0 && (
        <li className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">
          No products match this view.
        </li>
      )}
      {rows.map((row) => (
        <li key={row.productId} className="card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <Link
                href={`/admin/products/${row.productId}`}
                className="text-sm font-semibold text-gray-900 hover:text-brand-700"
              >
                {row.name}
              </Link>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
                <Badge
                  tone={
                    row.status === 'ACTIVE' ? 'green' : row.status === 'DRAFT' ? 'amber' : 'gray'
                  }
                >
                  {row.status}
                </Badge>
                <Badge tone={row.stockMode === 'LOCAL' ? 'blue' : 'neutral'}>
                  {row.stockMode === 'LOCAL' ? 'local stock' : 'supplier-synced'}
                </Badge>
                {row.stockMode === 'SUPPLIER_SYNC' && (
                  <span>
                    stock updates arrive from supplier feeds/webhooks — manual edits here are
                    overwritten on next sync
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleStatus(row)}
                loading={savingId === row.productId && !row.hasVariants}
              >
                {row.status === 'ACTIVE' ? 'Unpublish' : 'Publish'}
              </Button>
            </div>
          </div>

          {row.hasVariants ? (
            <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {row.variants.map((v) => (
                <li
                  key={v.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-gray-800">{v.name}</p>
                    <p
                      className={`text-sm tabular-nums ${v.isActive ? stockTone(v.stock, row.lowStockThreshold) : 'text-gray-300 line-through'}`}
                    >
                      {v.stock} in stock
                    </p>
                  </div>
                  <StockInput
                    value={v.stock}
                    saving={savingId === v.id}
                    onSave={(n) => saveStock(row.productId, v.id, n)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
              <p className={`text-sm tabular-nums ${stockTone(row.stock, row.lowStockThreshold)}`}>
                {row.stock} in stock
                {row.stock === 0 && (
                  <span className="ml-2 text-xs font-normal text-red-500">
                    sold out on storefront
                  </span>
                )}
                {row.stock > 0 && row.lowStockThreshold > 0 && row.stock <= row.lowStockThreshold && (
                  <span className="ml-2 text-xs font-normal text-amber-600">
                    low stock badge shown
                  </span>
                )}
              </p>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-gray-500">
                  low&nbsp;≤
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    className="w-16 rounded-md border border-gray-200 px-2 py-1 text-xs tabular-nums"
                    value={row.lowStockThreshold}
                    disabled={savingId === `thr-${row.productId}`}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((r) =>
                          r.productId === row.productId
                            ? { ...r, lowStockThreshold: Number(e.target.value) || 0 }
                            : r
                        )
                      )
                    }
                    onBlur={(e) => {
                      const n = Number(e.target.value) || 0;
                      if (n !== row.lowStockThreshold) return;
                      void saveThreshold(row.productId, n);
                    }}
                  />
                </label>
                <StockInput
                  value={row.stock}
                  saving={savingId === row.productId}
                  onSave={(n) => saveStock(row.productId, null, n)}
                />
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function StockInput({
  value,
  onSave,
  saving,
}: {
  value: number;
  onSave: (n: number) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const dirty = draft !== String(value);
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        min={0}
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label="New stock quantity"
        className="input-base w-20 py-1 text-right text-sm tabular-nums"
      />
      <Button
        size="sm"
        variant={dirty ? 'primary' : 'outline'}
        disabled={!dirty || saving}
        loading={saving}
        onClick={() => onSave(Math.max(0, parseInt(draft, 10) || 0))}
      >
        Set
      </Button>
    </div>
  );
}
