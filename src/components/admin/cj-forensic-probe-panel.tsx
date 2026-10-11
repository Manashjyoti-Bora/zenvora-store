'use client';

import { useState } from 'react';
import type { CjProbeResult } from '@/lib/suppliers/cj';
import { apiFetch, ApiClientError } from '@/lib/client/api';
import { toast } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/feedback';
import { Badge } from '@/components/ui/badge';

/**
 * Admin-only CJ forensic probe runner.
 *
 * Calls the read-only three-step probe (credential exchange → setting/get →
 * product/myProduct/query) and renders the structured, secret-free result:
 * codes, HTTP statuses, requestIds, timings, token LENGTHS and sha256
 * fingerprints. The probe never logs out, never retries and never exposes
 * key or token values — safe to run against production while diagnosing.
 */

/** The route answers with the probe result, or a Zenvora-side config gate. */
type ProbeResponse =
  | ({ zenvoraSide: true; configured: false; adapterError?: string | null; conclusion: string } &
      Partial<CjProbeResult>)
  | ({ zenvoraSide: false; configured: true; apiKeyEnvVar: string | null } & CjProbeResult);
export function CjForensicProbePanel({ supplierId }: { supplierId: string }) {
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState<CjProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setProbe(null);
    try {
      const result = await apiFetch<ProbeResponse>(
        `/api/admin/suppliers/${supplierId}/diagnostics/cj`,
        { method: 'POST' }
      );
      if (result.zenvoraSide === true) {
        // Configuration gate: the probe never ran. Surface the exact fix.
        setError(result.adapterError ?? result.conclusion);
        toast(result.conclusion, 'error');
        return;
      }
      setProbe(result);
      const hasProducts =
        (result.myProductQuery?.returned ?? 0) > 0 || (result.myProductQuery?.total ?? 0) > 0;
      toast(
        result.classification === null
          ? hasProducts
            ? 'CJ probe: all three steps succeeded and My Products returned items.'
            : 'CJ probe: auth & endpoints succeeded, but My Products returned 0 items.'
          : `CJ probe finished — failing step classified as ${result.classification}.`,
        result.classification === null ? (hasProducts ? 'success' : 'info') : 'error'
      );
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : 'CJ probe failed to run.';
      setError(message);
      toast(message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="cj-forensic-probe" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cj-forensic-probe" className="text-lg font-semibold text-ink-900">
          CJ connection diagnostics
        </h2>
        <Button size="sm" onClick={run} loading={busy}>
          Run CJ forensic probe
        </Button>
      </div>
      <p className="text-xs text-ink-400">
        Three read-only calls to CJ: credential exchange, <code>setting/get</code> and{' '}
        <code>product/myProduct/query</code>. No logout, no retries, no secrets in the result —
        token and API key appear only as lengths and sha256 fingerprints (safe to share with CJ
        support). A token length of <strong>exactly 500</strong> is the truncation signature from
        the production 1600001 investigation; CJ currently issues ~593-char tokens.
      </p>

      {error && (
        <Card className="border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</Card>
      )}

      {probe && (
        <div className="space-y-3">
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={probe.classification === null ? 'green' : 'red'}>
                {probe.classification ?? 'ALL STEPS OK'}
              </Badge>
              <span className="text-xs text-ink-400">
                total {probe.elapsedMs} ms · API key:{' '}
                {probe.apiKeyPresent ? (
                  <span className="font-mono">
                    {probe.apiKeyLength} chars · {probe.apiKeyFingerprint}
                  </span>
                ) : (
                  <span className="text-red-600">missing</span>
                )}
              </span>
            </div>
            <p className="mt-2 text-sm text-ink-700">{probe.conclusion}</p>
          </Card>

          <div className="grid gap-3 md:grid-cols-3">
            <ProbeStepCard
              title="1 · getAccessToken"
              step={probe.getAccessToken}
              extra={
                <span className="font-mono">
                  token {probe.getAccessToken.tokenLength ?? '—'} chars ·{' '}
                  {probe.getAccessToken.tokenFingerprint ?? 'no fingerprint'}
                </span>
              }
            />
            <ProbeStepCard
              title="2 · setting/get"
              step={probe.authenticatedProbe}
              extra={
                <span className="font-mono">
                  root={probe.authenticatedProbe.root ?? '—'} · isSandbox=
                  {String(probe.authenticatedProbe.isSandbox ?? '—')}
                </span>
              }
            />
            <ProbeStepCard
              title="3 · product/myProduct/query"
              step={probe.myProductQuery}
              extra={
                <span className="font-mono">
                  total={probe.myProductQuery.total ?? '—'} · returned=
                  {probe.myProductQuery.returned ?? '—'}
                  {probe.myProductQuery.listKey
                    ? ` · key=${probe.myProductQuery.listKey}`
                    : ''}
                </span>
              }
            />
          </div>
        </div>
      )}
    </section>
  );
}

interface ProbeStepCardProps {
  title: string;
  step: {
    ok: boolean;
    code: number | null;
    httpStatus: number | null;
    message: string | null;
    requestId: string | null;
    elapsedMs: number;
  };
  extra: React.ReactNode;
}

function ProbeStepCard({ title, step, extra }: ProbeStepCardProps) {
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink-900">{title}</p>
        <Badge tone={step.ok ? 'green' : 'red'}>{step.ok ? 'OK' : 'FAILED'}</Badge>
      </div>
      <dl className="mt-2 space-y-1 text-xs text-ink-600">
        <div className="flex justify-between gap-2">
          <dt>CJ code</dt>
          <dd className="font-mono">{step.code ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>HTTP</dt>
          <dd className="font-mono">{step.httpStatus ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>elapsed</dt>
          <dd className="font-mono">{step.elapsedMs} ms</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>requestId</dt>
          <dd className="break-all font-mono text-right">{step.requestId ?? '—'}</dd>
        </div>
        {step.message && (
          <div className="flex justify-between gap-2">
            <dt>message</dt>
            <dd className="break-all text-right text-red-600">{step.message}</dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt>detail</dt>
          <dd className="text-right">{extra}</dd>
        </div>
      </dl>
    </Card>
  );
}
