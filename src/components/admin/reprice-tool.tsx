'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/form';
import { Alert } from '@/components/ui/feedback';
import { TableWrap, Th, Td } from '@/components/ui/table';
import { formatINR } from '@/lib/money';

interface RepriceRow {
  productId: string;
  name: string;
  currentPricePaise: number;
  newPricePaise: number;
  estimatedNetProfitPaise: number;
  ruleName: string | null;
  warnings: string[];
}

export function RepriceTool({
  categories,
  suppliers,
}: {
  categories: Array<{ id: string; name: string }>;
  suppliers: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<'ALL' | 'CATEGORY' | 'SUPPLIER'>('ALL');
  const [categoryId, setCategoryId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [rows, setRows] = useState<RepriceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scopeMissing =
    (scope === 'CATEGORY' && !categoryId) || (scope === 'SUPPLIER' && !supplierId);

  async function run(apply: boolean) {
    if (apply) setApplying(true);
    else setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ rows: RepriceRow[]; applied: number }>(
        '/api/admin/products/reprice',
        {
          body: {
            scope,
            categoryId: scope === 'CATEGORY' ? categoryId : null,
            supplierId: scope === 'SUPPLIER' ? supplierId : null,
            apply,
          },
        }
      );
      setRows(result.rows);
      if (apply) {
        toast(`Applied new prices to ${result.applied} product(s)`, 'success');
        router.refresh();
      } else {
        toast(`Preview ready: ${result.rows.length} product(s) evaluated`, 'info');
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Repricing failed.');
    } finally {
      setBusy(false);
      setApplying(false);
    }
  }

  const changed = rows?.filter((r) => r.newPricePaise !== r.currentPricePaise) ?? [];

  return (
    <div className="space-y-5">
      <Alert tone="info" title="How bulk repricing works">
        <p className="text-sm">
          Every product in the selected scope is re-run through the pricing engine (product fields +
          applicable pricing rules, in precedence order). <strong>Preview first</strong>, check the
          diffs and warnings, then apply. Prices of unchanged products are not touched.
        </p>
      </Alert>

      <div className="card grid grid-cols-1 gap-4 p-4 sm:grid-cols-3 sm:p-5">
        <Field label="Scope">
          {(p) => (
            <Select {...p} value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              <option value="ALL">All non-archived products</option>
              <option value="CATEGORY">One category…</option>
              <option value="SUPPLIER">One supplier…</option>
            </Select>
          )}
        </Field>
        {scope === 'CATEGORY' && (
          <Field label="Category" required>
            {(p) => (
              <Select {...p} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Select…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {scope === 'SUPPLIER' && (
          <Field label="Supplier" required>
            {(p) => (
              <Select {...p} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Select…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <div className="flex items-end gap-2">
          <Button onClick={() => run(false)} loading={busy} disabled={scopeMissing}>
            Preview changes
          </Button>
          <Button
            variant="success"
            onClick={() => run(true)}
            loading={applying}
            disabled={scopeMissing || !rows || changed.length === 0}
          >
            Apply ({changed.length})
          </Button>
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {rows && (
        <section aria-labelledby="reprice-result">
          <h2 id="reprice-result" className="mb-3 text-base font-semibold text-gray-900">
            Preview: {rows.length} product(s), {changed.length} price change(s)
          </h2>
          <TableWrap className="max-h-[520px] overflow-y-auto">
            <table className="table-base">
              <thead className="sticky top-0 bg-gray-50">
                <tr>
                  <Th>Product</Th>
                  <Th>Current</Th>
                  <Th>New</Th>
                  <Th>Δ</Th>
                  <Th className="hidden md:table-cell">Est. net profit</Th>
                  <Th className="hidden lg:table-cell">Rule</Th>
                  <Th className="hidden lg:table-cell">Warnings</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => {
                  const diff = r.newPricePaise - r.currentPricePaise;
                  return (
                    <tr key={r.productId} className={diff !== 0 ? 'bg-amber-50/40' : undefined}>
                      <Td className="max-w-[220px] truncate font-medium text-gray-900">{r.name}</Td>
                      <Td className="tabular-nums">{formatINR(r.currentPricePaise)}</Td>
                      <Td className="font-semibold tabular-nums">{formatINR(r.newPricePaise)}</Td>
                      <Td
                        className={`tabular-nums ${diff > 0 ? 'text-emerald-700' : diff < 0 ? 'text-red-700' : 'text-gray-400'}`}
                      >
                        {diff === 0 ? '—' : `${diff > 0 ? '+' : ''}${formatINR(diff)}`}
                      </Td>
                      <Td className="hidden tabular-nums md:table-cell">
                        <span
                          className={
                            r.estimatedNetProfitPaise >= 0
                              ? 'text-emerald-700'
                              : 'font-semibold text-red-700'
                          }
                        >
                          {formatINR(r.estimatedNetProfitPaise)}
                        </span>
                      </Td>
                      <Td className="hidden max-w-[140px] truncate text-xs text-gray-500 lg:table-cell">
                        {r.ruleName ?? '—'}
                      </Td>
                      <Td className="hidden max-w-[200px] text-xs text-amber-700 lg:table-cell">
                        {r.warnings.join('; ')}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
          <p className="mt-2 text-[11px] text-gray-400">
            “Est. net profit” uses the settings-based gateway fee estimate; actual profit is
            recorded per order from real fees and costs.
          </p>
        </section>
      )}
    </div>
  );
}
