'use client';

import { useState } from 'react';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/feedback';

/**
 * Mode-2 action console.
 *
 * The component is a THIN client: it cannot grant permission, choose a cost or
 * bypass the kill switch. It sends an action key, validated args and a fresh
 * idempotency key; the server decides whether anything may run and records the
 * outcome. A disabled console stays visible so the owner can see exactly what
 * is (and is not) permitted.
 */

export interface ExecutableActionView {
  key: string;
  label: string;
  description: string;
  minLevel: number;
  sideEffects: string;
  maxPerDay: number;
  requiresArgs: 'NONE' | 'SUPPLIER_DRY_RUN';
}

interface Props {
  actions: ExecutableActionView[];
  suppliers: Array<{ id: string; name: string; isActive: boolean }>;
  actionsEnabled: boolean;
  moduleEnabled: boolean;
  remainingToday: number;
}

type Outcome =
  | { kind: 'idle' }
  | { kind: 'ok'; actionKey: string; result: Record<string, unknown>; remainingToday: number }
  | { kind: 'error'; message: string };

function makeKey(actionKey: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now()}${Math.random().toString(16).slice(2)}`;
  return `aiceo-${actionKey.toLowerCase()}-${random}`.slice(0, 120);
}

export function AiCeoActionQueue({ actions, suppliers, actionsEnabled, moduleEnabled, remainingToday }: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const [supplierId, setSupplierId] = useState<string>(suppliers.find((s) => s.isActive)?.id ?? '');

  const disabled = !moduleEnabled || !actionsEnabled;

  async function run(action: ExecutableActionView) {
    setPending(action.key);
    setOutcome({ kind: 'idle' });
    try {
      const args: Record<string, unknown> = {};
      if (action.requiresArgs === 'SUPPLIER_DRY_RUN') {
        args.supplierId = supplierId;
        args.mode = 'IMPORT_ELIGIBLE_DRAFT';
        args.limit = 100;
      }
      const data = await apiFetch<{
        actionKey: string;
        result: Record<string, unknown>;
        remainingToday: number;
      }>('/api/admin/ai-ceo/action', {
        method: 'POST',
        body: { actionKey: action.key, args, idempotencyKey: makeKey(action.key) },
      });
      setOutcome({ kind: 'ok', actionKey: data.actionKey, result: data.result, remainingToday: data.remainingToday });
    } catch (err) {
      setOutcome({
        kind: 'error',
        message: err instanceof ApiClientError ? err.message : 'The action could not be executed.',
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-ink-400">
        Low-risk, reversible operations only. Every run is idempotent, counted against a daily cap
        ({remainingToday} left in the 24 h window) and written to the audit log. Publishing, pricing,
        refunds and settings changes are <strong className="text-ink-700">not offered here</strong> — they
        remain owner decisions in their own admin screens.
      </p>

      {!moduleEnabled && (
        <Alert tone="warning" title="Module disabled">
          The AI CEO is switched off in Settings. Nothing on this page can run until it is re-enabled.
        </Alert>
      )}
      {moduleEnabled && !actionsEnabled && (
        <Alert tone="info" title="Actions are off (safe default)">
          Observing and recommending are active. Enable “AI CEO actions” in the automation controls below to
          allow the low-risk catalogue to run.
        </Alert>
      )}

      {suppliers.length > 0 && (
        <label className="block text-xs font-semibold uppercase tracking-wider text-ink-400">
          Supplier for dry runs
          <select
            className="mt-1 w-full rounded-lg border border-ink-900/15 bg-white px-3 py-2 text-sm font-normal text-ink-800"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            disabled={disabled}
          >
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.isActive ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </label>
      )}

      <ul className="space-y-2">
        {actions.map((action) => {
          const needsSupplier = action.requiresArgs === 'SUPPLIER_DRY_RUN';
          const blocked = disabled || (needsSupplier && !supplierId);
          return (
            <li key={action.key} className="rounded-xl border border-ink-900/10 bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-900">{action.label}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-400">{action.description}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-500">
                    <Badge tone="gray">level {action.minLevel}+</Badge>
                    <Badge tone="blue">{action.sideEffects.replace(/_/g, ' ')}</Badge>
                    <span>max {action.maxPerDay}/24 h</span>
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => run(action)}
                  disabled={blocked || pending !== null}
                  loading={pending === action.key}
                >
                  Run
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {outcome.kind === 'ok' && (
        <Alert tone="success" title={`${outcome.actionKey} completed`}>
          <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white/70 p-2 text-[11px] leading-relaxed">
            {JSON.stringify(outcome.result, null, 2)}
          </pre>
          <p className="mt-1 text-[11px]">
            Verified by re-reading system state on the next page load. {outcome.remainingToday} action(s) left
            today.
          </p>
        </Alert>
      )}
      {outcome.kind === 'error' && (
        <Alert tone="error" title="Action refused or failed">
          {outcome.message}
        </Alert>
      )}
    </div>
  );
}
