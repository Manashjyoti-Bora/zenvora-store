import { describe, expect, it } from 'vitest';
import {
  AI_CEO_ACTIONS,
  approvalRequiredActions,
  evaluateActionPolicy,
  executableActions,
  newIdempotencyKey,
  type ActionPolicyInput,
} from '@/lib/ai-ceo/actions';

const NOW = '2026-10-25T10:00:00.000Z';
const KEY = 'aiceo-test-key-0001';

function input(overrides: Partial<ActionPolicyInput> = {}): ActionPolicyInput {
  return {
    actionKey: 'RUN_JOB_QUEUE',
    args: {},
    actorLevel: 4,
    automation: { aiCeoEnabled: true, actionsEnabled: true },
    idempotencyKey: KEY,
    recentRuns: [],
    now: NOW,
    dailyLimit: 20,
    ...overrides,
  };
}

describe('AI CEO — action catalogue', () => {
  it('separates executable actions from owner-approval actions', () => {
    const executable = executableActions().map((a) => a.key);
    const approval = approvalRequiredActions().map((a) => a.key);
    expect(executable).toEqual(
      expect.arrayContaining(['RUN_JOB_QUEUE', 'RUN_SUPPLIER_DRY_RUN', 'REFRESH_DERIVED_CACHE', 'CREATE_INTERNAL_TASK'])
    );
    expect(approval).toEqual(expect.arrayContaining(['PUBLISH_PRODUCT', 'CHANGE_PRICE', 'ISSUE_REFUND', 'CHANGE_SETTINGS']));
    for (const key of executable) expect(approval).not.toContain(key);
  });

  it('lists every consequential action as approval-required with a human route', () => {
    for (const action of approvalRequiredActions()) {
      expect(action.execution).toBe('APPROVAL_REQUIRED');
      expect(action.description).toMatch(/Admin →|owner decision/i);
      expect(action.maxPerDay).toBe(0);
    }
  });
});

describe('AI CEO — action policy', () => {
  it('refuses consequential actions even for an owner', () => {
    for (const action of approvalRequiredActions()) {
      const result = evaluateActionPolicy(input({ actionKey: action.key, actorLevel: 4 }));
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.code).toBe('APPROVAL_REQUIRED');
        expect(result.message).toMatch(/cannot be executed by the AI CEO/i);
      }
    }
  });

  it('refuses everything while the kill switch is off', () => {
    const result = evaluateActionPolicy(
      input({ automation: { aiCeoEnabled: false, actionsEnabled: true }, actionKey: 'REFRESH_DERIVED_CACHE' })
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe('KILL_SWITCH');
  });

  it('keeps execution off until actions are explicitly enabled', () => {
    const result = evaluateActionPolicy(
      input({ automation: { aiCeoEnabled: true, actionsEnabled: false }, actionKey: 'REFRESH_DERIVED_CACHE' })
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe('ACTIONS_DISABLED');
      expect(result.message).toMatch(/Observing and recommending/i);
    }
  });

  it('enforces the per-action permission level', () => {
    const staffOnAdminAction = evaluateActionPolicy(input({ actionKey: 'RUN_JOB_QUEUE', actorLevel: 3 }));
    expect(staffOnAdminAction.allowed).toBe(false);
    if (!staffOnAdminAction.allowed) expect(staffOnAdminAction.code).toBe('FORBIDDEN');

    const staffOnDryRun = evaluateActionPolicy(
      input({ actionKey: 'RUN_SUPPLIER_DRY_RUN', actorLevel: 3, args: { supplierId: 'sup_1' } })
    );
    expect(staffOnDryRun.allowed).toBe(true);
  });

  it('validates action arguments strictly', () => {
    const missingSupplier = evaluateActionPolicy(input({ actionKey: 'RUN_SUPPLIER_DRY_RUN', args: {} }));
    expect(missingSupplier.allowed).toBe(false);
    if (!missingSupplier.allowed) expect(missingSupplier.code).toBe('INVALID_ARGS');

    const extraKey = evaluateActionPolicy(
      input({ actionKey: 'RUN_SUPPLIER_DRY_RUN', args: { supplierId: 'sup_1', publish: true } })
    );
    expect(extraKey.allowed).toBe(false);

    const tooBig = evaluateActionPolicy(
      input({ actionKey: 'RUN_SUPPLIER_DRY_RUN', args: { supplierId: 'sup_1', limit: 5000 } })
    );
    expect(tooBig.allowed).toBe(false);
  });

  it('applies documented defaults when optional arguments are omitted', () => {
    const result = evaluateActionPolicy(input({ actionKey: 'RUN_SUPPLIER_DRY_RUN', args: { supplierId: 'sup_1' } }));
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.args).toEqual({ supplierId: 'sup_1', mode: 'IMPORT_ELIGIBLE_DRAFT', limit: 100 });
    }
  });

  it('requires a well-formed idempotency key', () => {
    for (const key of [null, '', 'short', 'has spaces', 'x'.repeat(200), 'bad;chars']) {
      const result = evaluateActionPolicy(input({ idempotencyKey: key }));
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    }
  });

  it('blocks a replayed request with the same idempotency key', () => {
    const result = evaluateActionPolicy(
      input({ recentRuns: [{ actionKey: 'RUN_JOB_QUEUE', idempotencyKey: KEY, at: '2026-10-25T09:00:00.000Z' }] })
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe('DUPLICATE');
  });

  it('allows the same action with a different key', () => {
    const result = evaluateActionPolicy(
      input({ recentRuns: [{ actionKey: 'RUN_JOB_QUEUE', idempotencyKey: 'another-key-1234', at: '2026-10-25T09:00:00.000Z' }] })
    );
    expect(result.allowed).toBe(true);
  });

  it('enforces the per-action and global daily caps', () => {
    const older = '2026-10-25T08:00:00.000Z';
    const perAction = evaluateActionPolicy(
      input({
        actionKey: 'RUN_JOB_QUEUE',
        recentRuns: Array.from({ length: AI_CEO_ACTIONS.RUN_JOB_QUEUE.maxPerDay }, (_, i) => ({
          actionKey: 'RUN_JOB_QUEUE',
          idempotencyKey: `k-${i}-0000000`,
          at: older,
        })),
      })
    );
    expect(perAction.allowed).toBe(false);
    if (!perAction.allowed) expect(perAction.code).toBe('DAILY_LIMIT');

    const global = evaluateActionPolicy(
      input({
        actionKey: 'REFRESH_DERIVED_CACHE',
        dailyLimit: 2,
        recentRuns: [
          { actionKey: 'CREATE_INTERNAL_TASK', idempotencyKey: 'k-aaaaaaa1', at: older },
          { actionKey: 'CREATE_INTERNAL_TASK', idempotencyKey: 'k-aaaaaaa2', at: older },
        ],
      })
    );
    expect(global.allowed).toBe(false);
    if (!global.allowed) expect(global.message).toMatch(/global AI CEO limit/i);
  });

  it('ignores runs older than 24 h when counting limits', () => {
    const result = evaluateActionPolicy(
      input({
        actionKey: 'REFRESH_DERIVED_CACHE',
        dailyLimit: 1,
        recentRuns: [{ actionKey: 'REFRESH_DERIVED_CACHE', idempotencyKey: 'old-key-0001', at: '2026-10-20T10:00:00.000Z' }],
      })
    );
    expect(result.allowed).toBe(true);
  });

  it('reports the remaining allowance after a successful decision', () => {
    const result = evaluateActionPolicy(
      input({
        actionKey: 'REFRESH_DERIVED_CACHE',
        dailyLimit: 5,
        recentRuns: [
          { actionKey: 'CREATE_INTERNAL_TASK', idempotencyKey: 'k-bbbbbbb1', at: '2026-10-25T09:30:00.000Z' },
          { actionKey: 'CREATE_INTERNAL_TASK', idempotencyKey: 'k-bbbbbbb2', at: '2026-10-25T09:40:00.000Z' },
        ],
      })
    );
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.remainingToday).toBe(2);
  });

  it('rejects unknown action keys', () => {
    const result = evaluateActionPolicy(input({ actionKey: 'DELETE_ALL_ORDERS' }));
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe('UNKNOWN_ACTION');
      expect(result.message).toMatch(/Executable actions/);
    }
  });

  it('generates idempotency keys that satisfy the policy', () => {
    const key = newIdempotencyKey();
    expect(key).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    expect(newIdempotencyKey()).not.toBe(key);
  });
});
