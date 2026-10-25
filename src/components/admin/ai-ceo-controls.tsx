'use client';

import { useState } from 'react';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';

export interface AiCeoConfig {
  enabled: boolean;
  actionsEnabled: boolean;
  dailyActionLimit: number;
  providerNarrativeEnabled: boolean;
  monthlyTokenBudget: number;
}

/**
 * Automation controls: the global kill switch and the cost/usage caps.
 * Changes go through PATCH /api/admin/ai-ceo/config, which is ADMIN-only and
 * audited with before/after values.
 */
export function AiCeoControls({ initial }: { initial: AiCeoConfig }) {
  const [form, setForm] = useState<AiCeoConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const data = await apiFetch<{ aiCeo: AiCeoConfig }>('/api/admin/ai-ceo/config', {
        method: 'PATCH',
        body: form,
      });
      setForm(data.aiCeo);
      setMessage({ tone: 'success', text: 'Saved. The new limits apply immediately (the audit log records the change).' });
    } catch (err) {
      setMessage({
        tone: 'error',
        text: err instanceof ApiClientError ? err.message : 'Could not save the settings.',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Toggle
        label="AI CEO enabled"
        hint="Turns the whole module on or off. Observing and recommending are read-only."
        checked={form.enabled}
        onChange={(enabled) => setForm((f) => ({ ...f, enabled }))}
      />
      <Toggle
        label="Allow low-risk actions"
        hint="Permits the Mode-2 catalogue (queue drain, dry run, cache refresh, internal task). Off by default."
        checked={form.actionsEnabled}
        onChange={(actionsEnabled) => setForm((f) => ({ ...f, actionsEnabled }))}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold uppercase tracking-wider text-ink-400">
          Daily action limit
          <input
            type="number"
            min={0}
            max={200}
            value={form.dailyActionLimit}
            onChange={(e) => setForm((f) => ({ ...f, dailyActionLimit: Number(e.target.value) || 0 }))}
            className="mt-1 w-full rounded-lg border border-ink-900/15 bg-white px-3 py-2 text-sm font-normal text-ink-800 tabular-nums"
          />
          <span className="mt-1 block text-[11px] font-normal normal-case tracking-normal text-ink-500">
            0 disables execution entirely.
          </span>
        </label>
        <label className="block text-xs font-semibold uppercase tracking-wider text-ink-400">
          Monthly narrative token budget
          <input
            type="number"
            min={0}
            max={2000000}
            step={1000}
            value={form.monthlyTokenBudget}
            onChange={(e) => setForm((f) => ({ ...f, monthlyTokenBudget: Number(e.target.value) || 0 }))}
            className="mt-1 w-full rounded-lg border border-ink-900/15 bg-white px-3 py-2 text-sm font-normal text-ink-800 tabular-nums"
          />
          <span className="mt-1 block text-[11px] font-normal normal-case tracking-normal text-ink-500">
            Checked before every provider call, measured over 30 days.
          </span>
        </label>
      </div>
      <Toggle
        label="Allow AI narrative (requires a provider)"
        hint="Opt-in. The narrative is labelled unverified and never feeds back into a metric."
        checked={form.providerNarrativeEnabled}
        onChange={(providerNarrativeEnabled) => setForm((f) => ({ ...f, providerNarrativeEnabled }))}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} loading={saving} disabled={!dirty || saving} size="sm">
          Save controls
        </Button>
        {dirty && <span className="text-[11px] text-ink-500">Unsaved changes</span>}
      </div>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-xl border border-ink-900/10 bg-white p-3">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink-900">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-500">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-5 w-5 shrink-0 rounded border-ink-900/25 text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500"
      />
    </label>
  );
}
