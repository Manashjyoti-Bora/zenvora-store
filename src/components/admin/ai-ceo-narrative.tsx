'use client';

import { useState } from 'react';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';

type NarrativeState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; text: string; model: string; label: string }
  | { kind: 'unavailable'; message: string };

/**
 * Optional written summary from a configured model provider.
 *
 * The rendered text is explicitly labelled unverified and is never merged into
 * the metrics above it. When no provider/budget/opt-in exists the component
 * explains why instead of pretending a model answered.
 */
export function AiCeoNarrative({
  providerConfigured,
  narrativeEnabled,
}: {
  providerConfigured: boolean;
  narrativeEnabled: boolean;
}) {
  const [state, setState] = useState<NarrativeState>({ kind: 'idle' });

  async function generate() {
    setState({ kind: 'loading' });
    try {
      const data = await apiFetch<{
        ok: boolean;
        text?: string;
        model?: string;
        label?: string | null;
        message?: string;
      }>('/api/admin/ai-ceo/narrative', { method: 'POST', body: {} });
      if (data.ok && data.text) {
        setState({ kind: 'ok', text: data.text, model: data.model ?? 'model', label: data.label ?? 'AI narrative — unverified' });
      } else {
        setState({ kind: 'unavailable', message: data.message ?? 'No narrative is available.' });
      }
    } catch (err) {
      setState({
        kind: 'unavailable',
        message: err instanceof ApiClientError ? err.message : 'The narrative request failed.',
      });
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-ink-400">
        {providerConfigured
          ? 'A model provider is configured. It only rewrites the findings above into prose; every figure stays deterministic and no output is stored as fact.'
          : 'No model provider is configured, so no narrative is generated. Everything on this page is computed from database records without a model.'}
      </p>
      <Button
        size="sm"
        variant="outline"
        onClick={generate}
        loading={state.kind === 'loading'}
        disabled={!providerConfigured || !narrativeEnabled || state.kind === 'loading'}
      >
        Generate narrative
      </Button>
      {!narrativeEnabled && providerConfigured && (
        <p className="text-[11px] text-ink-500">
          Narrative is switched off in the automation controls below (provider use is opt-in).
        </p>
      )}
      {state.kind === 'ok' && (
        <figure className="rounded-xl border border-brand-200 bg-brand-50/60 p-3">
          <figcaption className="text-[10px] font-bold uppercase tracking-eyebrow text-brand-800">
            {state.label} · {state.model}
          </figcaption>
          <blockquote className="mt-1.5 text-sm leading-relaxed text-ink-800">{state.text}</blockquote>
          <p className="mt-2 text-[11px] text-brand-800/80">
            Written by a model from the digest above. Not verified — check every claim against the computed
            figures.
          </p>
        </figure>
      )}
      {state.kind === 'unavailable' && (
        <Alert tone="info" title="No narrative generated">
          {state.message}
        </Alert>
      )}
    </div>
  );
}
