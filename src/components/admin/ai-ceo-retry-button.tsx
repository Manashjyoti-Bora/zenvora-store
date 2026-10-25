'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { Button } from '@/components/ui/button';

/**
 * Retry a FAILED Mode-2 action with a brand-new idempotency key.
 *
 * The server decides again whether it may run (kill switch, permission, caps),
 * so a retry can never bypass policy — and it can never reuse the failed
 * request's key, which would be rejected as a duplicate.
 */
export function AiCeoRetryButton({ actionKey }: { actionKey: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'running' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function retry() {
    setState('running');
    setMessage(null);
    const random =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().replace(/-/g, '')
        : `${Date.now()}${Math.random().toString(16).slice(2)}`;
    try {
      await apiFetch('/api/admin/ai-ceo/action', {
        method: 'POST',
        // Only actions that validate without arguments are offered a retry
        // button (see ai-ceo/history.ts#isRetryableWithoutArgs).
        body: { actionKey, args: {}, idempotencyKey: `aiceo-retry-${random}`.slice(0, 120) },
      });
      setState('idle');
      router.refresh();
    } catch (err) {
      setState('error');
      setMessage(err instanceof ApiClientError ? err.message : 'Retry failed.');
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={retry} loading={state === 'running'} disabled={state === 'running'}>
        Retry
      </Button>
      {message && <span className="max-w-[16rem] text-right text-[11px] text-red-700">{message}</span>}
    </div>
  );
}
