import { z } from 'zod';
import type { AiCeoLevel } from './tools';

/**
 * AI CEO action catalogue and policy (pure).
 *
 * Two hard rules, enforced here and asserted by tests:
 *
 *  1. Consequential actions (publishing, pricing, refunds, settings, supplier
 *     live ordering) are listed with `execution: 'APPROVAL_REQUIRED'` and can
 *     never be executed through the AI CEO endpoints — not even by an owner.
 *     They must be performed in the dedicated admin screen, where the existing
 *     guard, confirmation and audit path already exist.
 *  2. Nothing executes unless the kill switch is on, the caller has the
 *     required level, the input validates, the call is idempotent and the
 *     per-action daily cap has room.
 */

export type ActionExecution = 'ALLOWED' | 'APPROVAL_REQUIRED';

export interface AiCeoActionDefinition {
  key: string;
  label: string;
  description: string;
  /** Permission level required (0–4, see src/lib/auth/permissions.ts). */
  minLevel: AiCeoLevel;
  execution: ActionExecution;
  /** Declared side effects so the UI can state them before the click. */
  sideEffects: 'READ_ONLY' | 'AUDIT_ONLY' | 'DERIVED_CACHE' | 'IDEMPOTENT_JOBS';
  /** Actions that change state require the automation kill switch to be on. */
  requiresKillSwitch: boolean;
  maxPerDay: number;
  inputSchema: z.ZodTypeAny;
}

const emptyArgs = z.object({}).strict();

export const AI_CEO_ACTIONS: Record<string, AiCeoActionDefinition> = {
  RUN_JOB_QUEUE: {
    key: 'RUN_JOB_QUEUE',
    label: 'Drain the due job queue',
    description:
      'Runs the existing processDueJobs({ limit: 25 }). Jobs are deduplicated by dedupeKey and bounded by maxAttempts, so re-running cannot duplicate a supplier order or a notification.',
    minLevel: 4,
    execution: 'ALLOWED',
    sideEffects: 'IDEMPOTENT_JOBS',
    requiresKillSwitch: true,
    maxPerDay: 12,
    inputSchema: emptyArgs,
  },
  RUN_SUPPLIER_DRY_RUN: {
    key: 'RUN_SUPPLIER_DRY_RUN',
    label: 'Run a supplier dry run',
    description:
      'Builds the read-only supplier evaluation report (no product is created, published or timestamped). Requires a configured supplier.',
    minLevel: 3,
    execution: 'ALLOWED',
    sideEffects: 'READ_ONLY',
    requiresKillSwitch: true,
    maxPerDay: 20,
    inputSchema: z
      .object({
        supplierId: z.string().min(1).max(64),
        mode: z.enum(['IMPORT_ELIGIBLE_DRAFT', 'SAFE_PUBLISH_ELIGIBLE']).default('IMPORT_ELIGIBLE_DRAFT'),
        limit: z.number().int().min(1).max(200).default(100),
      })
      .strict(),
  },
  REFRESH_DERIVED_CACHE: {
    key: 'REFRESH_DERIVED_CACHE',
    label: 'Refresh derived caches',
    description:
      'Clears the in-process settings cache and revalidates the storefront paths. No business record is modified.',
    minLevel: 3,
    execution: 'ALLOWED',
    sideEffects: 'DERIVED_CACHE',
    requiresKillSwitch: true,
    maxPerDay: 100,
    inputSchema: emptyArgs,
  },
  CREATE_INTERNAL_TASK: {
    key: 'CREATE_INTERNAL_TASK',
    label: 'Record an internal task',
    description:
      'Writes an auditable internal task note (stored in the audit log with a stable idempotency key). It does not notify customers or change the storefront.',
    minLevel: 2,
    execution: 'ALLOWED',
    sideEffects: 'AUDIT_ONLY',
    requiresKillSwitch: true,
    maxPerDay: 50,
    inputSchema: z
      .object({
        title: z.string().min(3).max(120),
        detail: z.string().max(1000).optional(),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
      })
      .strict(),
  },
  RECORD_REPORT_SNAPSHOT: {
    key: 'RECORD_REPORT_SNAPSHOT',
    label: 'Save the current report digest',
    description:
      'Stores a digest of the deterministic report (headline, level, blocker counts) in the audit log for later comparison. No model is involved.',
    minLevel: 2,
    execution: 'ALLOWED',
    sideEffects: 'AUDIT_ONLY',
    requiresKillSwitch: true,
    maxPerDay: 24,
    inputSchema: emptyArgs,
  },

  // --- Listed for transparency; NOT executable through this endpoint --------
  PUBLISH_PRODUCT: {
    key: 'PUBLISH_PRODUCT',
    label: 'Publish a product',
    description: 'Customer-visible. Use Admin → Products / Product mapping, which requires owner approval.',
    minLevel: 4,
    execution: 'APPROVAL_REQUIRED',
    sideEffects: 'AUDIT_ONLY',
    requiresKillSwitch: true,
    maxPerDay: 0,
    inputSchema: emptyArgs,
  },
  CHANGE_PRICE: {
    key: 'CHANGE_PRICE',
    label: 'Change a selling price',
    description: 'Commercial terms. Use Admin → Bulk reprice or the product form.',
    minLevel: 4,
    execution: 'APPROVAL_REQUIRED',
    sideEffects: 'AUDIT_ONLY',
    requiresKillSwitch: true,
    maxPerDay: 0,
    inputSchema: emptyArgs,
  },
  ISSUE_REFUND: {
    key: 'ISSUE_REFUND',
    label: 'Issue a refund',
    description: 'Moves money. Use Admin → Refunds after reconciling with the provider.',
    minLevel: 4,
    execution: 'APPROVAL_REQUIRED',
    sideEffects: 'AUDIT_ONLY',
    requiresKillSwitch: true,
    maxPerDay: 0,
    inputSchema: emptyArgs,
  },
  CHANGE_SETTINGS: {
    key: 'CHANGE_SETTINGS',
    label: 'Change store settings',
    description: 'Affects every customer. Use Admin → Settings.',
    minLevel: 4,
    execution: 'APPROVAL_REQUIRED',
    sideEffects: 'AUDIT_ONLY',
    requiresKillSwitch: true,
    maxPerDay: 0,
    inputSchema: emptyArgs,
  },
  ENABLE_AUTO_PUBLISH: {
    key: 'ENABLE_AUTO_PUBLISH',
    label: 'Enable automatic publishing',
    description: 'Owner decision with customer-visible consequences. Use Admin → Settings.',
    minLevel: 4,
    execution: 'APPROVAL_REQUIRED',
    sideEffects: 'AUDIT_ONLY',
    requiresKillSwitch: true,
    maxPerDay: 0,
    inputSchema: emptyArgs,
  },
};

export function isKnownAction(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(AI_CEO_ACTIONS, key);
}

export function executableActions(): AiCeoActionDefinition[] {
  return Object.values(AI_CEO_ACTIONS).filter((a) => a.execution === 'ALLOWED');
}

export function approvalRequiredActions(): AiCeoActionDefinition[] {
  return Object.values(AI_CEO_ACTIONS).filter((a) => a.execution === 'APPROVAL_REQUIRED');
}

export interface ActionPolicyInput {
  actionKey: string;
  args: unknown;
  actorLevel: AiCeoLevel;
  automation: { aiCeoEnabled: boolean; actionsEnabled: boolean };
  idempotencyKey: string | null | undefined;
  /** Recent AI CEO runs (audit-derived), newest first. */
  recentRuns: Array<{ actionKey: string; idempotencyKey: string | null; at: string }>;
  now: string;
  /** Global cap from Settings.aiCeo.dailyActionLimit (0 disables execution). */
  dailyLimit: number;
}

export type ActionPolicyErrorCode =
  | 'UNKNOWN_ACTION'
  | 'APPROVAL_REQUIRED'
  | 'KILL_SWITCH'
  | 'ACTIONS_DISABLED'
  | 'FORBIDDEN'
  | 'INVALID_ARGS'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'DUPLICATE'
  | 'DAILY_LIMIT';

export type ActionPolicyResult =
  | { allowed: true; action: AiCeoActionDefinition; args: unknown; remainingToday: number }
  | { allowed: false; code: ActionPolicyErrorCode; message: string };

const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

export function evaluateActionPolicy(input: ActionPolicyInput): ActionPolicyResult {
  if (!isKnownAction(input.actionKey)) {
    return {
      allowed: false,
      code: 'UNKNOWN_ACTION',
      message: `Unknown action. Executable actions: ${executableActions().map((a) => a.key).join(', ')}.`,
    };
  }
  const action = AI_CEO_ACTIONS[input.actionKey];

  // Consequential actions are refused outright — the caller must use the
  // dedicated admin screen. This is checked before the kill switch so the
  // reason is never ambiguous.
  if (action.execution !== 'ALLOWED') {
    return {
      allowed: false,
      code: 'APPROVAL_REQUIRED',
      message: `${action.label} is an owner decision and cannot be executed by the AI CEO. Use the admin screen instead.`,
    };
  }

  if (!input.automation.aiCeoEnabled) {
    return {
      allowed: false,
      code: 'KILL_SWITCH',
      message: 'The AI CEO is disabled in Settings. No action can run until an owner re-enables it.',
    };
  }
  if (action.requiresKillSwitch && !input.automation.actionsEnabled) {
    return {
      allowed: false,
      code: 'ACTIONS_DISABLED',
      message: 'AI CEO actions are switched off. Observing and recommending still work; execution requires the owner to enable actions.',
    };
  }
  if (input.actorLevel < action.minLevel) {
    return {
      allowed: false,
      code: 'FORBIDDEN',
      message: `${action.label} requires permission level ${action.minLevel}; the current session is level ${input.actorLevel}.`,
    };
  }

  const parsedArgs = action.inputSchema.safeParse(input.args ?? {});
  if (!parsedArgs.success) {
    return {
      allowed: false,
      code: 'INVALID_ARGS',
      message: parsedArgs.error.issues
        .map((i) => `${i.path.join('.') || 'args'}: ${i.message}`)
        .join('; '),
    };
  }

  const key = input.idempotencyKey?.trim() ?? '';
  if (!IDEMPOTENCY_RE.test(key)) {
    return {
      allowed: false,
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message:
        'An idempotency key (8–128 characters: letters, digits, dot, colon, dash, underscore) is required so a retried request cannot act twice.',
    };
  }
  if (input.recentRuns.some((run) => run.actionKey === action.key && run.idempotencyKey === key)) {
    return {
      allowed: false,
      code: 'DUPLICATE',
      message: 'This exact request has already been executed. Use a new idempotency key for a new attempt.',
    };
  }

  if (input.dailyLimit <= 0) {
    return {
      allowed: false,
      code: 'DAILY_LIMIT',
      message: 'The daily action limit is 0, which disables execution.',
    };
  }

  const dayAgo = Date.parse(input.now) - 86_400_000;
  const runsLast24h = input.recentRuns.filter((run) => {
    const at = Date.parse(run.at);
    return Number.isFinite(at) && at >= dayAgo;
  });
  const sameAction = runsLast24h.filter((run) => run.actionKey === action.key);
  if (sameAction.length >= action.maxPerDay) {
    return {
      allowed: false,
      code: 'DAILY_LIMIT',
      message: `${action.label} has reached its cap of ${action.maxPerDay} run(s) in 24 h.`,
    };
  }
  if (runsLast24h.length >= input.dailyLimit) {
    return {
      allowed: false,
      code: 'DAILY_LIMIT',
      message: `The global AI CEO limit of ${input.dailyLimit} action(s) in 24 h has been reached.`,
    };
  }

  return {
    allowed: true,
    action,
    args: parsedArgs.data,
    remainingToday: Math.max(0, input.dailyLimit - runsLast24h.length - 1),
  };
}

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `aiceo-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
