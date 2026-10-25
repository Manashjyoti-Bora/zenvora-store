'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';

interface DryRunSummary {
  generatedAt: string;
  examined: number;
  truncated: boolean;
  wouldPublish: number;
  wouldImportDraft: number;
  wouldHold: number;
  wouldReject: number;
  wouldSkip: number;
  demandCounts: { VERIFIED: number; LOW_EVIDENCE: number; UNKNOWN: number };
  economics: {
    priceableItems: number;
    medianContributionPercent: number | null;
    itemsBelowMinMargin: number;
    itemsWithUnknownShipping: number;
  };
  thresholds: { autoPublishEnabled: boolean };
  topReasons: Array<{ reason: string; count: number }>;
  writes: number;
}

export function SupplierCatalogOps({
  suppliers,
  initialConfig,
}: {
  suppliers: Array<{ id: string; name: string; type: string; isActive: boolean }>;
  initialConfig: {
    enabled: boolean;
    autoPublishEligible: boolean;
    minMarginPercent: number;
    minProfitRupees: number;
    maxSellingPriceRupees: number;
    dailyImportLimit: number;
    minDemandConfidenceForAutoPublish: 'UNKNOWN' | 'LOW_EVIDENCE' | 'VERIFIED';
    verifiedDemandMinListedNum: number;
    minScoreForAutoPublish: number;
    staleAfterHours: number;
  };
}) {
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>(
    suppliers.find((s) => s.isActive)?.id ?? suppliers[0]?.id ?? ''
  );
  const [includeGeneralCatalog, setIncludeGeneralCatalog] = useState(false);
  const [autoImportOnSync, setAutoImportOnSync] = useState(initialConfig.enabled);
  const [autoPublishOnSync, setAutoPublishOnSync] = useState(initialConfig.autoPublishEligible);

  const [minMarginPercent, setMinMarginPercent] = useState(initialConfig.minMarginPercent);
  const [minProfitRupees, setMinProfitRupees] = useState(initialConfig.minProfitRupees);
  const [maxSellingPriceRupees, setMaxSellingPriceRupees] = useState(
    initialConfig.maxSellingPriceRupees
  );
  const [dailyImportLimit, setDailyImportLimit] = useState(initialConfig.dailyImportLimit);
  const [minDemandConfidence, setMinDemandConfidence] = useState(
    initialConfig.minDemandConfidenceForAutoPublish
  );
  const [verifiedMinListed, setVerifiedMinListed] = useState(initialConfig.verifiedDemandMinListedNum);
  const [minScore, setMinScore] = useState(initialConfig.minScoreForAutoPublish);
  const [staleAfterHours, setStaleAfterHours] = useState(initialConfig.staleAfterHours);
  const [dryRun, setDryRun] = useState<DryRunSummary | null>(null);

  async function runBulk(
    mode: 'EVALUATE_ONLY' | 'IMPORT_ELIGIBLE_DRAFT' | 'SAFE_PUBLISH_ELIGIBLE'
  ) {
    if (busyAction) return;
    setBusyAction(mode);
    try {
      const res = await apiFetch<{
        evaluated: number;
        importedDraft: number;
        published: number;
        heldForReview: number;
        rejected: number;
      }>('/api/admin/supplier-products/bulk', {
        method: 'POST',
        body: { mode },
      });
      toast(
        `Evaluated ${res.evaluated} items — ${res.published} published, ${res.importedDraft} draft/review, ${res.rejected} rejected.`,
        'success'
      );
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Bulk action failed', 'error');
    } finally {
      setBusyAction(null);
    }
  }

  async function runDiscoverySync() {
    if (!selectedSupplierId || busyAction) return;
    setBusyAction('SYNC');
    try {
      const res = await apiFetch<{
        total: number;
        created: number;
        updated: number;
        message?: string;
      }>(`/api/admin/suppliers/${selectedSupplierId}/sync`, {
        method: 'POST',
        body: {
          limit: 200,
          includeGeneralCatalog,
          autoImport: autoImportOnSync,
          autoPublishEligible: autoPublishOnSync,
        },
      });
      toast(
        `Discovered ${res.total} item(s) (${res.created} new, ${res.updated} updated). ${res.message ?? ''}`,
        'success'
      );
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Discovery sync failed', 'error');
    } finally {
      setBusyAction(null);
    }
  }

  async function runDryRun(mode: 'IMPORT_ELIGIBLE_DRAFT' | 'SAFE_PUBLISH_ELIGIBLE') {
    if (!selectedSupplierId || busyAction) return;
    setBusyAction(`DRY_${mode}`);
    try {
      const res = await apiFetch<DryRunSummary>(
        `/api/admin/suppliers/${selectedSupplierId}/dry-run?mode=${mode}&limit=200`
      );
      setDryRun(res);
      toast(`Dry run examined ${res.examined} item(s) — nothing was written.`, 'info');
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Dry run failed', 'error');
    } finally {
      setBusyAction(null);
    }
  }

  async function saveAutoImportSettings(e: React.FormEvent) {
    e.preventDefault();
    if (busyAction) return;
    setBusyAction('SETTINGS');
    try {
      await apiFetch('/api/admin/settings', {
        method: 'PATCH',
        body: {
          autoImport: {
            enabled: autoImportOnSync,
            autoPublishEligible: autoPublishOnSync,
            minMarginPercent: Number(minMarginPercent) || 15,
            minProfitPaise: Math.round((Number(minProfitRupees) || 0) * 100),
            maxSellingPricePaise: Math.round((Number(maxSellingPriceRupees) || 25000) * 100),
            dailyImportLimit: Math.max(1, Math.round(Number(dailyImportLimit) || 100)),
            minDemandConfidenceForAutoPublish: minDemandConfidence,
            verifiedDemandMinListedNum: Math.max(1, Math.round(Number(verifiedMinListed) || 20)),
            minScoreForAutoPublish: Math.min(100, Math.max(0, Math.round(Number(minScore) || 0))),
            staleAfterHours: Math.max(1, Math.round(Number(staleAfterHours) || 48)),
          },
        },
      });
      toast('Auto-import & quality gate rules saved.', 'success');
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Failed to save rules', 'error');
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Discovery & Bulk Operations Card */}
      <div className="card space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">
              Automated Pipeline
            </p>
            <h2 className="text-sm font-bold text-ink-900">
              Discover, Rank, Import &amp; Safe Bulk Publish
            </h2>
          </div>
        </div>

        {suppliers.length > 0 && (
          <div className="space-y-2 rounded-lg border border-ink-900/10 bg-cream-50/70 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-medium text-ink-700" htmlFor="sync-supplier-select">
                Supplier:
              </label>
              <select
                id="sync-supplier-select"
                value={selectedSupplierId}
                onChange={(e) => setSelectedSupplierId(e.target.value)}
                className="input h-8 py-1 text-xs"
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.type})
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                loading={busyAction === 'SYNC'}
                disabled={Boolean(busyAction)}
                onClick={runDiscoverySync}
              >
                Run Discovery &amp; Sync
              </Button>
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-ink-600">
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={includeGeneralCatalog}
                  onChange={(e) => setIncludeGeneralCatalog(e.target.checked)}
                />
                Include CJ general catalog (listV2)
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={autoImportOnSync}
                  onChange={(e) => setAutoImportOnSync(e.target.checked)}
                />
                Auto-import eligible on sync
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={autoPublishOnSync}
                  onChange={(e) => setAutoPublishOnSync(e.target.checked)}
                />
                Auto-publish when all quality gates pass
              </label>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={busyAction === 'EVALUATE_ONLY'}
            disabled={Boolean(busyAction)}
            onClick={() => runBulk('EVALUATE_ONLY')}
          >
            Re-evaluate &amp; Rank All
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={busyAction === 'IMPORT_ELIGIBLE_DRAFT'}
            disabled={Boolean(busyAction)}
            onClick={() => runBulk('IMPORT_ELIGIBLE_DRAFT')}
          >
            Bulk Import Eligible (as Draft)
          </Button>
          <Button
            type="button"
            size="sm"
            variant="primary"
            loading={busyAction === 'SAFE_PUBLISH_ELIGIBLE'}
            disabled={Boolean(busyAction)}
            onClick={() => runBulk('SAFE_PUBLISH_ELIGIBLE')}
          >
            Safe Bulk Publish Eligible
          </Button>
        </div>
        <p className="text-[11px] text-ink-500">
          Safe Bulk Publish promotes or imports products as ACTIVE only when all 10 quality gates
          pass (verified cost, margin floor, valid image, description, India shipping, stock, and
          policy compliance). Any incomplete item is held as DRAFT / NEEDS_REVIEW.
        </p>

        <div className="rounded-xl border border-dashed border-ink-900/15 bg-cream-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Dry run</p>
              <p className="text-[11px] text-ink-500">
                Preview what the pipeline would do with the selected supplier&apos;s rows — same
                evaluator, pricing rules and thresholds, <strong>zero writes</strong>.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                loading={busyAction === 'DRY_IMPORT_ELIGIBLE_DRAFT'}
                disabled={Boolean(busyAction) || !selectedSupplierId}
                onClick={() => runDryRun('IMPORT_ELIGIBLE_DRAFT')}
              >
                Dry run: import
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                loading={busyAction === 'DRY_SAFE_PUBLISH_ELIGIBLE'}
                disabled={Boolean(busyAction) || !selectedSupplierId}
                onClick={() => runDryRun('SAFE_PUBLISH_ELIGIBLE')}
              >
                Dry run: publish
              </Button>
            </div>
          </div>
          {dryRun && (
            <div className="mt-3 space-y-2 text-xs text-ink-700">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                <dt className="text-ink-500">Examined</dt>
                <dd className="font-semibold tabular-nums sm:col-span-2">
                  {dryRun.examined}
                  {dryRun.truncated ? ' (truncated to the newest 200)' : ''}
                </dd>
                <dt className="text-ink-500">Would publish</dt>
                <dd className="font-semibold tabular-nums sm:col-span-2">
                  {dryRun.wouldPublish}
                  {!dryRun.thresholds.autoPublishEnabled && (
                    <span className="ml-1 font-normal text-ink-500">(automatic publishing is off)</span>
                  )}
                </dd>
                <dt className="text-ink-500">Would import as draft</dt>
                <dd className="font-semibold tabular-nums sm:col-span-2">{dryRun.wouldImportDraft}</dd>
                <dt className="text-ink-500">Would hold for review</dt>
                <dd className="font-semibold tabular-nums sm:col-span-2">{dryRun.wouldHold}</dd>
                <dt className="text-ink-500">Would reject</dt>
                <dd className="font-semibold tabular-nums sm:col-span-2">{dryRun.wouldReject}</dd>
                <dt className="text-ink-500">Skipped (dup / mapped / invalid)</dt>
                <dd className="font-semibold tabular-nums sm:col-span-2">{dryRun.wouldSkip}</dd>
                <dt className="text-ink-500">Demand evidence</dt>
                <dd className="tabular-nums sm:col-span-2">
                  verified {dryRun.demandCounts.VERIFIED} · low {dryRun.demandCounts.LOW_EVIDENCE} · unknown{' '}
                  {dryRun.demandCounts.UNKNOWN}
                </dd>
                <dt className="text-ink-500">Median contribution</dt>
                <dd className="tabular-nums sm:col-span-2">
                  {dryRun.economics.medianContributionPercent == null
                    ? 'n/a'
                    : `${dryRun.economics.medianContributionPercent}% of ex-GST revenue (estimate)`}
                  {dryRun.economics.itemsWithUnknownShipping > 0 &&
                    ` · ${dryRun.economics.itemsWithUnknownShipping} without a shipping quote (upper bound)`}
                </dd>
              </dl>
              {dryRun.topReasons.length > 0 && (
                <div>
                  <p className="font-semibold text-ink-600">Top reasons</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink-600">
                    {dryRun.topReasons.slice(0, 5).map((r) => (
                      <li key={r.reason}>
                        <span className="tabular-nums font-medium">{r.count}×</span> {r.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-[11px] text-ink-500">
                Generated {new Date(dryRun.generatedAt).toLocaleString('en-IN')} · writes: {dryRun.writes}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Quality Gate & Eligibility Rules Card */}
      <form onSubmit={saveAutoImportSettings} className="card space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">
              Quality Gate Rules
            </p>
            <h2 className="text-sm font-bold text-ink-900">
              Indian Reselling Eligibility Thresholds
            </h2>
          </div>
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            loading={busyAction === 'SETTINGS'}
            disabled={Boolean(busyAction)}
          >
            Save Rules
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="block text-[11px] font-medium text-ink-600">
              Min Gross Margin (%)
            </label>
            <input
              type="number"
              min={0}
              max={85}
              step={1}
              value={minMarginPercent}
              onChange={(e) => setMinMarginPercent(Number(e.target.value))}
              className="input mt-1 h-8 text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-ink-600">
              Min Gross Profit (₹)
            </label>
            <input
              type="number"
              min={0}
              max={50000}
              step={10}
              value={minProfitRupees}
              onChange={(e) => setMinProfitRupees(Number(e.target.value))}
              className="input mt-1 h-8 text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-ink-600">
              Max Selling Price (₹)
            </label>
            <input
              type="number"
              min={100}
              max={500000}
              step={100}
              value={maxSellingPriceRupees}
              onChange={(e) => setMaxSellingPriceRupees(Number(e.target.value))}
              className="input mt-1 h-8 text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-ink-600">
              Daily Import Limit
            </label>
            <input
              type="number"
              min={1}
              max={2000}
              step={10}
              value={dailyImportLimit}
              onChange={(e) => setDailyImportLimit(Number(e.target.value))}
              className="input mt-1 h-8 text-xs"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-ink-900/10 pt-3 sm:grid-cols-4">
          <div>
            <label className="block text-[11px] font-medium text-ink-600">
              Min demand evidence to auto-publish
            </label>
            <select
              value={minDemandConfidence}
              onChange={(e) =>
                setMinDemandConfidence(e.target.value as 'UNKNOWN' | 'LOW_EVIDENCE' | 'VERIFIED')
              }
              className="input mt-1 h-8 text-xs"
            >
              <option value="UNKNOWN">None (unit economics only)</option>
              <option value="LOW_EVIDENCE">Low evidence or better</option>
              <option value="VERIFIED">Verified only</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-ink-600">
              Sample size for “verified” (CJ listedNum ≥)
            </label>
            <input
              type="number"
              min={1}
              max={1000000}
              step={1}
              value={verifiedMinListed}
              onChange={(e) => setVerifiedMinListed(Number(e.target.value))}
              className="input mt-1 h-8 text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-ink-600">
              Min score to recommend ACTIVE (0–100)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="input mt-1 h-8 text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-ink-600">
              Treat as stale after (hours)
            </label>
            <input
              type="number"
              min={1}
              max={720}
              step={1}
              value={staleAfterHours}
              onChange={(e) => setStaleAfterHours(Number(e.target.value))}
              className="input mt-1 h-8 text-xs"
            />
          </div>
        </div>
        <p className="text-[11px] text-ink-500">
          Demand confidence is reported as <strong>UNKNOWN</strong> whenever CJ or store order
          history lacks verified demand metrics — scores never use random or fabricated demand data.
          The demand gate only affects automatic publishing; it never rejects an import.
        </p>
      </form>
    </div>
  );
}
