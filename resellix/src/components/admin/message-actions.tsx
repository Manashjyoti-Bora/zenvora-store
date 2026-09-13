'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';

export function MessageStatusActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function set(next: 'NEW' | 'READ' | 'RESOLVED') {
    setBusy(next);
    try {
      await apiFetch(`/api/admin/messages/${id}`, { method: 'PATCH', body: { status: next } });
      toast(
        next === 'RESOLVED' ? 'Marked resolved' : next === 'READ' ? 'Marked read' : 'Marked as new',
        'success'
      );
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : 'Could not update message', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex justify-end gap-2">
      {status !== 'READ' && status !== 'RESOLVED' && (
        <Button variant="outline" size="sm" loading={busy === 'READ'} onClick={() => set('READ')}>
          Mark read
        </Button>
      )}
      {status !== 'RESOLVED' && (
        <Button size="sm" loading={busy === 'RESOLVED'} onClick={() => set('RESOLVED')}>
          Resolve
        </Button>
      )}
      {status === 'RESOLVED' && (
        <Button variant="ghost" size="sm" loading={busy === 'NEW'} onClick={() => set('NEW')}>
          Reopen
        </Button>
      )}
    </div>
  );
}
