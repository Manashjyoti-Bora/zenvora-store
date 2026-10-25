import { describe, expect, it } from 'vitest';
import { historyCounts, summariseAiCeoHistory, type HistoryRow } from '@/lib/ai-ceo/history';

function row(overrides: Partial<HistoryRow> & Pick<HistoryRow, 'action'>): HistoryRow {
  return {
    id: overrides.id ?? 'aud_1',
    action: overrides.action,
    actorEmail: overrides.actorEmail ?? 'owner@example.test',
    createdAt: overrides.createdAt ?? '2026-10-25T09:00:00.000Z',
    data: overrides.data ?? {},
  };
}

describe('AI CEO — execution history', () => {
  it('maps each audit action to a clear outcome', () => {
    const entries = summariseAiCeoHistory([
      row({ id: 'a', action: 'ai_ceo.action', data: { actionKey: 'REFRESH_DERIVED_CACHE' } }),
      row({ id: 'b', action: 'ai_ceo.action.failed', data: { actionKey: 'RUN_JOB_QUEUE' } }),
      row({ id: 'c', action: 'ai_ceo.action.denied', data: { actionKey: 'PUBLISH_PRODUCT', code: 'APPROVAL_REQUIRED' } }),
      row({ id: 'd', action: 'ai_ceo.narrative', data: { tokensUsed: 420 } }),
      row({ id: 'e', action: 'ai_ceo.narrative.blocked', data: { code: 'BUDGET_EXCEEDED' } }),
      row({ id: 'f', action: 'ai_ceo.config.updated', data: { before: {}, after: {} } }),
    ]);

    expect(entries.map((e) => e.outcome)).toEqual([
      'SUCCEEDED',
      'FAILED',
      'REFUSED',
      'RECORDED',
      'REFUSED',
      'RECORDED',
    ]);
    expect(entries[0].label).toMatch(/Refresh derived caches/);
    expect(entries[2].code).toBe('APPROVAL_REQUIRED');
    expect(entries[3].tokensUsed).toBe(420);
    expect(entries[1].code).toBe('EXECUTION_FAILED');
  });

  it('offers a retry only for failed actions that can run without arguments', () => {
    const entries = summariseAiCeoHistory([
      row({ id: 'a', action: 'ai_ceo.action.failed', data: { actionKey: 'REFRESH_DERIVED_CACHE' } }),
      row({ id: 'b', action: 'ai_ceo.action.failed', data: { actionKey: 'RUN_SUPPLIER_DRY_RUN' } }),
      row({ id: 'c', action: 'ai_ceo.action.failed', data: { actionKey: 'CHANGE_SETTINGS' } }),
      row({ id: 'd', action: 'ai_ceo.action.failed', data: { actionKey: 'NOT_A_REAL_ACTION' } }),
    ]);
    expect(entries.map((e) => e.retryable)).toEqual([true, false, false, false]);
  });

  it('never copies arbitrary payload fields into the UI model (redaction by construction)', () => {
    const hostile = {
      actionKey: 'CREATE_INTERNAL_TASK',
      idempotencyKey: 'aiceo-12345678',
      result: { secret: 'SUPPLIER_API_KEY=xyz' },
      text: 'narrative body that must never be stored',
      error: 'internal stack trace with credentials',
      customerEmail: 'someone@example.test',
    };
    const [entry] = summariseAiCeoHistory([row({ action: 'ai_ceo.action', data: hostile })]);
    const serialised = JSON.stringify(entry);
    expect(serialised).not.toMatch(/SUPPLIER_API_KEY/);
    expect(serialised).not.toMatch(/narrative body/);
    expect(serialised).not.toMatch(/stack trace/);
    expect(serialised).not.toMatch(/someone@example\.test/);
    expect(entry.actionKey).toBe('CREATE_INTERNAL_TASK');
  });

  it('drops unknown audit actions instead of guessing', () => {
    const entries = summariseAiCeoHistory([
      row({ action: 'settings.updated' }),
      row({ action: 'orders.manual_refund' }),
      row({ action: 'ai_ceo.action', data: { actionKey: 'REFRESH_DERIVED_CACHE' } }),
    ]);
    expect(entries).toHaveLength(1);
  });

  it('tolerates malformed payloads without throwing', () => {
    const entries = summariseAiCeoHistory([
      row({ id: 'a', action: 'ai_ceo.action', data: null }),
      row({ id: 'b', action: 'ai_ceo.narrative', data: { tokensUsed: 'lots' } }),
      row({ id: 'c', action: 'ai_ceo.action.denied', data: { code: 42 } }),
    ]);
    expect(entries).toHaveLength(3);
    expect(entries[0].actionKey).toBeNull();
    expect(entries[1].tokensUsed).toBeNull();
    expect(entries[2].code).toBeNull();
  });

  it('counts outcomes for the dashboard summary', () => {
    const entries = summariseAiCeoHistory([
      row({ id: 'a', action: 'ai_ceo.action', data: { actionKey: 'REFRESH_DERIVED_CACHE' } }),
      row({ id: 'b', action: 'ai_ceo.action.failed', data: { actionKey: 'RUN_JOB_QUEUE' } }),
      row({ id: 'c', action: 'ai_ceo.action.denied', data: { actionKey: 'PUBLISH_PRODUCT', code: 'APPROVAL_REQUIRED' } }),
    ]);
    expect(historyCounts(entries)).toEqual({ succeeded: 1, failed: 1, refused: 1 });
  });
});
