'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';

export function SupplierSyncButton({
  supplierId,
  supportsSync,
  type,
}: {
  supplierId: string;
  supportsSync: boolean;
  type: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function sync() {
    setBusy(true);
    try {
      const result = await apiFetch<{
        synced?: boolean;
        created: number;
        updated: number;
        total: number;
        skippedNoCost?: number;
        skippedNoSku?: number;
        message?: string;
      }>(`/api/admin/suppliers/${supplierId}/sync`);
      const base = `Catalog sync: ${result.created} new, ${result.updated} updated (${result.total} fetched)`;
      const hasItems = result.total > 0 && result.created + result.updated > 0;
      toast(
        result.message ? `${base}. ${result.message}` : base,
        hasItems ? 'success' : 'info'
      );
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Catalog sync failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!supportsSync) {
    return (
      <span
        className="rounded-lg bg-cream-100 px-3 py-1.5 text-xs text-ink-400"
        title={`${type} suppliers manage their catalog manually`}
      >
        Catalog sync n/a for {type}
      </span>
    );
  }

  return (
    <Button size="sm" onClick={sync} loading={busy}>
      Sync catalog now
    </Button>
  );
}
