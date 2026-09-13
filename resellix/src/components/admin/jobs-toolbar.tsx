'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';

/** "Run due jobs now" — triggers one processing pass without waiting for cron. */
export function JobsToolbar() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function runDue() {
    setBusy(true);
    try {
      const stats = await apiFetch<{
        claimed: number;
        succeeded: number;
        failed: number;
        retried: number;
      }>('/api/admin/jobs/run');
      toast(
        `Job pass: ${stats.claimed} claimed · ${stats.succeeded} succeeded · ${stats.failed} failed · ${stats.retried} retried`,
        stats.failed > 0 ? 'error' : 'success'
      );
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Could not run jobs', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" variant="outline" onClick={runDue} loading={busy}>
        Run due jobs now
      </Button>
      <p className="text-xs text-gray-400">
        Jobs also run automatically after enqueue and via <code>/api/cron/jobs</code> (see
        SETUP_CHECKLIST for cron wiring).
      </p>
    </div>
  );
}

export function RetryJobButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function retry() {
    setBusy(true);
    try {
      await apiFetch(`/api/admin/jobs/${jobId}/retry`);
      toast('Job reset to pending — retrying now', 'success');
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Could not retry job', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={retry} loading={busy}>
      Retry
    </Button>
  );
}
