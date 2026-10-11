'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';

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
        <p className="text-[11px] text-ink-500">
          Demand confidence is reported as <strong>UNKNOWN</strong> whenever CJ or store order
          history lacks verified demand metrics — scores never use random or fabricated demand data.
        </p>
      </form>
    </div>
  );
}
