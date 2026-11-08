import { AI_CEO_ACTIONS } from './actions';

/**
 * Execution history for the AI CEO.
 *
 * The audit log is the system of record: every executed, failed or refused
 * action is a row there, so the dashboard reads history from the same place a
 * security reviewer would. This module is pure and **whitelist-based**: only
 * known scalar fields are copied out of the JSON payload. Result blobs, error
 * bodies and (never stored) narrative text cannot leak into the UI through it.
 */

export type HistoryOutcome = 'SUCCEEDED' | 'FAILED' | 'REFUSED' | 'RECORDED';

export interface HistoryRow {
  id: string;
  action: string;
  actorEmail: string | null;
  createdAt: string;
  data: unknown;
}

export interface AiCeoHistoryEntry {
  id: string;
  at: string;
  action: string;
  label: string;
  outcome: HistoryOutcome;
  actionKey: string | null;
  code: string | null;
  actorEmail: string | null;
  tokensUsed: number | null;
  /** A failed *executable* action can be retried with a fresh idempotency key. */
  retryable: boolean;
}

const MAX_FIELD = 120;

function scalar(value: unknown, max = MAX_FIELD): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : null;
}

function actionLabel(actionKey: string | null): string {
  if (!actionKey) return 'AI CEO action';
  const def = AI_CEO_ACTIONS[actionKey];
  return def?.label ?? actionKey;
}

/**
 * A retry is only offered when the action can run with no arguments. An action
 * that needs a supplier id (dry run) cannot be replayed safely from a one-click
 * button, so it is not marked retryable rather than offered a button that would
 * fail validation.
 */
function isRetryableWithoutArgs(actionKey: string | null): boolean {
  if (!actionKey) return false;
  const def = AI_CEO_ACTIONS[actionKey];
  if (!def || def.execution !== 'ALLOWED') return false;
  return def.inputSchema.safeParse({}).success;
}

/**
 * Convert audit rows into display entries. Unknown actions are dropped rather
 * than guessed at, and the order is preserved (callers pass newest-first).
 */
export function summariseAiCeoHistory(rows: HistoryRow[]): AiCeoHistoryEntry[] {
  const entries: AiCeoHistoryEntry[] = [];

  for (const row of rows) {
    const data = (row.data && typeof row.data === 'object' ? row.data : {}) as Record<string, unknown>;
    const actionKey = scalar(data.actionKey, 64);
    const tokens = typeof data.tokensUsed === 'number' && Number.isFinite(data.tokensUsed) ? data.tokensUsed : null;

    switch (row.action) {
      case 'ai_ceo.action':
        entries.push({
          id: row.id,
          at: row.createdAt,
          action: row.action,
          label: `${actionLabel(actionKey)} — executed`,
          outcome: 'SUCCEEDED',
          actionKey,
          code: null,
          actorEmail: row.actorEmail,
          tokensUsed: null,
          retryable: false,
        });
        break;
      case 'ai_ceo.action.failed':
        entries.push({
          id: row.id,
          at: row.createdAt,
          action: row.action,
          label: `${actionLabel(actionKey)} — failed`,
          outcome: 'FAILED',
          actionKey,
          code: 'EXECUTION_FAILED',
          actorEmail: row.actorEmail,
          tokensUsed: null,
          retryable: isRetryableWithoutArgs(actionKey),
        });
        break;
      case 'ai_ceo.action.denied':
        entries.push({
          id: row.id,
          at: row.createdAt,
          action: row.action,
          label: `${actionLabel(actionKey)} — refused`,
          outcome: 'REFUSED',
          actionKey,
          code: scalar(data.code, 48),
          actorEmail: row.actorEmail,
          tokensUsed: null,
          retryable: false,
        });
        break;
      case 'ai_ceo.narrative':
        entries.push({
          id: row.id,
          at: row.createdAt,
          action: row.action,
          label: 'AI narrative generated (unverified)',
          outcome: 'RECORDED',
          actionKey: null,
          code: null,
          actorEmail: row.actorEmail,
          tokensUsed: tokens,
          retryable: false,
        });
        break;
      case 'ai_ceo.narrative.blocked':
        entries.push({
          id: row.id,
          at: row.createdAt,
          action: row.action,
          label: 'AI narrative not generated',
          outcome: 'REFUSED',
          actionKey: null,
          code: scalar(data.code, 48),
          actorEmail: row.actorEmail,
          tokensUsed: null,
          retryable: false,
        });
        break;
      case 'ai_ceo.config.updated':
        entries.push({
          id: row.id,
          at: row.createdAt,
          action: row.action,
          label: 'Automation controls updated',
          outcome: 'RECORDED',
          actionKey: null,
          code: null,
          actorEmail: row.actorEmail,
          tokensUsed: null,
          retryable: false,
        });
        break;
      default:
        break;
    }
  }

  return entries;
}

export function historyCounts(entries: AiCeoHistoryEntry[]): {
  succeeded: number;
  failed: number;
  refused: number;
} {
  return {
    succeeded: entries.filter((e) => e.outcome === 'SUCCEEDED').length,
    failed: entries.filter((e) => e.outcome === 'FAILED').length,
    refused: entries.filter((e) => e.outcome === 'REFUSED').length,
  };
}
