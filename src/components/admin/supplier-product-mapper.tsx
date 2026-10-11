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
  productStatus?: string | null;
  candidateTitle?: string | null;
  categoryName?: string | null;
  imageCount?: number;
  tier?: 'HIGH_POTENTIAL' | 'PROMISING' | 'NEEDS_REVIEW' | 'NOT_ELIGIBLE';
  score?: number;
  demandConfidence?: 'VERIFIED' | 'LOW_EVIDENCE' | 'UNKNOWN';
  codSuitable?: boolean;
  eligibleForAutoPublish?: boolean;
  estimatedSellingPriceRupees?: number;
  effectiveMarginPercent?: number;
  summary?: string;
  blockingReasons?: string[];
  publicationBlockers?: string[];
  factors?: Array<{
    key: string;
    label: string;
    score: number;
    maxScore: number;
    status: 'pass' | 'warn' | 'fail';
    explanation: string;
  }>;
  fieldSources?: Record<string, string>;
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
  const [filter, setFilter] = useState<
    | 'ALL'
    | 'UNMAPPED'
    | 'MAPPED'
    | 'HIGH_POTENTIAL'
    | 'PROMISING'
    | 'NEEDS_REVIEW'
    | 'NOT_ELIGIBLE'
  >('ALL');
  const [search, setSearch] = useState('');
  const [mapping, setMapping] = useState<SupplierProductRow | null>(null);
  const [inspecting, setInspecting] = useState<SupplierProductRow | null>(null);
  const [targetProduct, setTargetProduct] = useState('');
  const [costOverride, setCostOverride] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPricing, setLastPricing] = useState<PricingSummary | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);

  /** Create a DRAFT or ACTIVE catalog product from an unmapped, costed supplier entry. */
  async function publishRow(r: SupplierProductRow, status: 'DRAFT' | 'ACTIVE' = 'DRAFT') {
    setPublishingId(r.id);
    try {
      const data = await apiFetch<{ productId: string; slug: string; warnings: string[] }>(
        `/api/admin/supplier-products/${r.id}/publish`,
        { body: { status } }
      );
      toast(
        status === 'ACTIVE'
          ? `Product published LIVE (/products/${data.slug}).`
          : `Draft product created — review it, then set it to ACTIVE.${data?.warnings?.[0] ? ` ${data.warnings[0]}` : ''}`,
        'success'
      );
      router.refresh();
    } catch (err) {
      toast(
        err instanceof ApiClientError ? err.message : 'Could not create the catalog product',
        'error'
      );
    } finally {
      setPublishingId(null);
    }
  }

  const visible = useMemo(() => {
    let list = rows;
    if (filter === 'UNMAPPED') list = list.filter((r) => !r.productId);
    else if (filter === 'MAPPED') list = list.filter((r) => Boolean(r.productId));
    else if (
      filter === 'HIGH_POTENTIAL' ||
      filter === 'PROMISING' ||
      filter === 'NEEDS_REVIEW' ||
      filter === 'NOT_ELIGIBLE'
    ) {
      list = list.filter((r) => r.tier === filter);
    }
    if (search.trim()) {
      const t = search.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.supplierSku.toLowerCase().includes(t) ||
          r.supplierName.toLowerCase().includes(t) ||
          (r.candidateTitle ?? '').toLowerCase().includes(t) ||
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
              className="text-xs text-ink-400 hover:text-ink-700"
              onClick={() => setLastPricing(null)}
            >
              dismiss
            </button>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-ink-400">Previous price</dt>
              <dd className="tabular-nums">₹{(lastPricing.oldPricePaise / 100).toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-400">New price</dt>
              <dd className="font-semibold tabular-nums">
                ₹{(lastPricing.newPricePaise / 100).toFixed(2)}
                {lastPricing.applied ? '' : ' (unchanged)'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-400">Gross margin</dt>
              <dd className="tabular-nums">{lastPricing.marginPercent.toFixed(2)}%</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-400">Min safe price</dt>
              <dd className="tabular-nums">₹{(lastPricing.minSafePricePaise / 100).toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-400">Max safe discount</dt>
              <dd className="tabular-nums">₹{(lastPricing.maxSafeDiscountPaise / 100).toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-400">Rule applied</dt>
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
          <p className="mt-2 text-xs text-ink-400">
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
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter mapping state">
          {(
            [
              ['ALL', 'All'],
              ['UNMAPPED', 'Unmapped'],
              ['MAPPED', 'Mapped'],
              ['HIGH_POTENTIAL', 'High Potential'],
              ['PROMISING', 'Promising'],
              ['NEEDS_REVIEW', 'Needs Review'],
              ['NOT_ELIGIBLE', 'Not Eligible'],
            ] as const
          ).map(([f, label]) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                filter === f
                  ? 'bg-ink-900 text-white'
                  : 'bg-white text-ink-600 ring-1 ring-ink-900/10 hover:bg-cream-50/70'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="ml-auto text-xs tabular-nums text-ink-400">
          {visible.length} shown{rows.length > 200 ? ` (of ${rows.length})` : ''}
        </p>
      </div>

      {rows.length === 0 ? (
        <Alert tone="info">
          The supplier catalog is empty. For HTTP_REST/CJ/DEMO suppliers use{' '}
          <strong>Run Discovery &amp; Sync</strong>; for manual suppliers add products directly and
          set their supplier SKU on the product form.
        </Alert>
      ) : (
        <TableWrap>
          <table className="table-base">
            <thead className="bg-cream-50">
              <tr>
                <Th>Supplier SKU / Candidate</Th>
                {showSupplierColumn && <Th className="hidden md:table-cell">Supplier</Th>}
                <Th>Cost &amp; Est. Price</Th>
                <Th className="hidden sm:table-cell">Stock</Th>
                <Th>Eligibility &amp; Ranking</Th>
                <Th className="hidden lg:table-cell">Last sync</Th>
                <Th>Mapped product</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-900/5">
              {visible.map((r) => (
                <tr
                  key={r.id}
                  className={
                    r.productId ? 'hover:bg-cream-50/70' : 'bg-amber-50/30 hover:bg-amber-50/60'
                  }
                >
                  <Td>
                    <p className="font-mono text-xs font-semibold text-ink-900">{r.supplierSku}</p>
                    {r.candidateTitle && r.candidateTitle !== r.supplierSku && (
                      <p className="mt-0.5 line-clamp-1 max-w-[220px] text-xs font-medium text-ink-700">
                        {r.candidateTitle}
                      </p>
                    )}
                    {r.externalId && (
                      <p className="text-[10px] text-ink-400">ext: {r.externalId}</p>
                    )}
                    {r.categoryName && (
                      <p className="text-[10px] text-ink-500">cat: {r.categoryName}</p>
                    )}
                  </Td>
                  {showSupplierColumn && (
                    <Td className="hidden text-xs text-ink-600 md:table-cell">{r.supplierName}</Td>
                  )}
                  <Td className="tabular-nums">
                    <span className="font-medium text-ink-900">
                      ₹{r.supplierCost.toLocaleString('en-IN')}
                    </span>
                    {r.supplierShippingCost != null ? (
                      <span className="block text-[10px] text-ink-400">
                        +₹{r.supplierShippingCost.toLocaleString('en-IN')} ship
                      </span>
                    ) : (
                      <span className="block text-[10px] text-amber-600">ship unverified</span>
                    )}
                    {r.estimatedSellingPriceRupees != null && r.estimatedSellingPriceRupees > 0 && (
                      <span className="mt-0.5 block text-[11px] font-semibold text-brand-700">
                        → ₹{r.estimatedSellingPriceRupees.toLocaleString('en-IN')}{' '}
                        {r.effectiveMarginPercent != null
                          ? `(${r.effectiveMarginPercent.toFixed(0)}% mgn)`
                          : ''}
                      </span>
                    )}
                  </Td>
                  <Td className="hidden text-xs sm:table-cell">
                    {r.stockQty != null ? (
                      <span
                        className={
                          r.stockQty === 0
                            ? 'font-semibold text-red-600'
                            : 'tabular-nums text-ink-700'
                        }
                      >
                        {r.stockQty}
                      </span>
                    ) : r.inStock != null ? (
                      <Badge tone={r.inStock ? 'green' : 'red'}>
                        {r.inStock ? 'in stock' : 'out'}
                      </Badge>
                    ) : (
                      <span className="text-ink-300">unknown</span>
                    )}
                  </Td>
                  <Td>
                    {r.tier ? (
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge
                            tone={
                              r.tier === 'HIGH_POTENTIAL'
                                ? 'green'
                                : r.tier === 'PROMISING'
                                  ? 'blue'
                                  : r.tier === 'NEEDS_REVIEW'
                                    ? 'amber'
                                    : 'red'
                            }
                          >
                            {r.tier.replace(/_/g, ' ')}
                          </Badge>
                          {r.score != null && (
                            <span className="text-[11px] font-bold tabular-nums text-ink-700">
                              {r.score}/100
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-ink-500">
                          Demand: {r.demandConfidence ?? 'UNKNOWN'}
                          {r.codSuitable ? ' · COD OK' : ''}
                        </p>
                        {r.blockingReasons && r.blockingReasons.length > 0 ? (
                          <p className="line-clamp-1 max-w-[220px] text-[10px] font-medium text-red-600">
                            {r.blockingReasons[0]}
                          </p>
                        ) : r.publicationBlockers && r.publicationBlockers.length > 0 ? (
                          <p className="line-clamp-1 max-w-[220px] text-[10px] text-amber-700">
                            {r.publicationBlockers[0]}
                          </p>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setInspecting(r)}
                          className="text-[10px] font-semibold text-brand-700 underline"
                        >
                          Why this score?
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-ink-400">Not evaluated</span>
                    )}
                  </Td>
                  <Td className="hidden text-[11px] text-ink-400 lg:table-cell">
                    {fmt(r.lastSyncedAt)}
                  </Td>
                  <Td>
                    {r.productId && r.productName ? (
                      <div>
                        <Link
                          href={`/admin/products/${r.productId}`}
                          className="text-xs font-medium text-brand-700 hover:underline"
                        >
                          {r.productName}
                        </Link>
                        {r.productStatus && (
                          <span className="mt-0.5 block text-[10px] uppercase text-ink-400">
                            {r.productStatus}
                          </span>
                        )}
                      </div>
                    ) : r.tier === 'NOT_ELIGIBLE' ? (
                      <Badge tone="red">rejected</Badge>
                    ) : (
                      <Badge tone="amber">unmapped</Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    <div className="flex flex-col items-end gap-1">
                      <button
                        type="button"
                        onClick={() => openMap(r)}
                        className="text-xs font-medium text-brand-700 hover:underline"
                      >
                        {r.productId ? 'Change map' : 'Map →'}
                      </button>
                      {!r.productId && r.tier !== 'NOT_ELIGIBLE' && (
                        <>
                          <button
                            type="button"
                            onClick={() => publishRow(r, 'DRAFT')}
                            disabled={publishingId === r.id}
                            className="text-xs font-medium text-ink-500 hover:text-brand-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                            title={
                              r.supplierCost > 0
                                ? 'Create a draft catalog product from this supplier entry'
                                : 'This entry has no usable supplier cost'
                            }
                          >
                            {publishingId === r.id ? 'Saving…' : 'Import as Draft'}
                          </button>
                          {r.eligibleForAutoPublish && (
                            <button
                              type="button"
                              onClick={() => publishRow(r, 'ACTIVE')}
                              disabled={publishingId === r.id}
                              className="text-xs font-semibold text-emerald-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                              title="Passes all quality gates — publish directly as ACTIVE"
                            >
                              Publish Live
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      <Modal
        open={inspecting !== null}
        onClose={() => setInspecting(null)}
        title={`Eligibility & Ranking Breakdown — ${inspecting?.supplierSku ?? ''}`}
        wide
        footer={
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setInspecting(null)}>
              Close
            </Button>
          </div>
        }
      >
        {inspecting && (
          <div className="space-y-4 text-sm">
            <div className="rounded-lg border border-ink-900/10 bg-cream-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-ink-900">
                    {inspecting.candidateTitle ?? inspecting.supplierSku}
                  </p>
                  <p className="text-xs text-ink-500">{inspecting.summary}</p>
                </div>
                <div className="text-right">
                  <Badge
                    tone={
                      inspecting.tier === 'HIGH_POTENTIAL'
                        ? 'green'
                        : inspecting.tier === 'PROMISING'
                          ? 'blue'
                          : inspecting.tier === 'NEEDS_REVIEW'
                            ? 'amber'
                            : 'red'
                    }
                  >
                    {inspecting.tier} ({inspecting.score ?? 0}/100)
                  </Badge>
                  <p className="mt-1 text-[11px] text-ink-500">
                    Demand confidence: <strong>{inspecting.demandConfidence ?? 'UNKNOWN'}</strong>
                  </p>
                </div>
              </div>
            </div>

            {inspecting.blockingReasons && inspecting.blockingReasons.length > 0 && (
              <Alert tone="error">
                <p className="font-semibold">Disqualifying / Blocking Reasons:</p>
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {inspecting.blockingReasons.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </Alert>
            )}

            {inspecting.publicationBlockers && inspecting.publicationBlockers.length > 0 && (
              <Alert tone="warning">
                <p className="font-semibold">Quality Gates Holding Automatic Publication:</p>
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {inspecting.publicationBlockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </Alert>
            )}

            {inspecting.factors && inspecting.factors.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-400">
                  Weighted Factor Scores
                </h4>
                <div className="divide-y divide-ink-900/10 rounded-lg border border-ink-900/10">
                  {inspecting.factors.map((f) => (
                    <div key={f.key} className="flex items-start justify-between gap-3 p-3">
                      <div>
                        <p className="font-medium text-ink-900">{f.label}</p>
                        <p className="text-xs text-ink-500">{f.explanation}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <Badge
                          tone={
                            f.status === 'pass'
                              ? 'green'
                              : f.status === 'warn'
                                ? 'amber'
                                : 'red'
                          }
                        >
                          {f.score}/{f.maxScore}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {inspecting.fieldSources && Object.keys(inspecting.fieldSources).length > 0 && (
              <div>
                <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-ink-400">
                  Field Data Provenance
                </h4>
                <dl className="grid grid-cols-2 gap-2 rounded-lg bg-cream-50 p-3 text-xs sm:grid-cols-3">
                  {Object.entries(inspecting.fieldSources).map(([k, v]) => (
                    <div key={k}>
                      <dt className="font-semibold text-ink-600">{k}</dt>
                      <dd className="font-mono text-[11px] text-ink-500">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        )}
      </Modal>

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
          <p className="text-xs text-ink-400">
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
