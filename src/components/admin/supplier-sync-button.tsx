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
      const result = await apiFetch<{ created: number; updated: number; total: number }>(
        `/api/admin/suppliers/${supplierId}/sync`
      );
      toast(
        `Catalog sync: ${result.created} new, ${result.updated} updated (${result.total} fetched)`,
        'success'
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
        className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-gray-400"
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
