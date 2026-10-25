import { prisma } from '@/lib/db';
import { getSettings, invalidateSettingsCache } from '@/lib/settings';
import { auditLog } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { permissionLevelOf } from '@/lib/auth/permissions';
import type { SessionUser } from '@/lib/auth/session';
import {
  AI_CEO_ACTIONS,
  evaluateActionPolicy,
  type ActionPolicyErrorCode,
} from './actions';
import { loadAiCeoSnapshot } from './snapshot';
import { buildAiCeoReport } from './engine';

/**
 * Server-side executor for the AI CEO's Mode-2 (approved, low-risk) actions.
 *
 * Ordering is deliberate: load state → evaluate the pure policy (kill switch,
 * permission, input, idempotency, caps) → only then touch anything → audit the
 * outcome. A refusal is audited too, because repeated refused attempts are a
 * security signal the owner should be able to see.
 */

export interface ExecuteActionParams {
  actionKey: string;
  args: unknown;
  idempotencyKey: string | null | undefined;
  actor: Pick<SessionUser, 'id' | 'email' | 'role' | 'status'>;
  req?: Request;
}

export type ExecuteActionResult =
  | {
      ok: true;
      actionKey: string;
      result: Record<string, unknown>;
      executedAt: string;
      remainingToday: number;
      audit: 'written' | 'failed';
    }
  | { ok: false; code: ActionPolicyErrorCode | 'EXECUTION_FAILED'; message: string };

const RUN_WINDOW_MS = 86_400_000;

interface RecentRun {
  actionKey: string;
  idempotencyKey: string | null;
  at: string;
}

export async function loadRecentAiCeoRuns(now: Date): Promise<RecentRun[]> {
  const rows = await prisma.auditLog.findMany({
    where: { action: 'ai_ceo.action', createdAt: { gte: new Date(now.getTime() - RUN_WINDOW_MS) } },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { data: true, createdAt: true },
  });
  const runs: RecentRun[] = [];
  for (const row of rows) {
    const data = row.data as { actionKey?: unknown; idempotencyKey?: unknown } | null;
    if (typeof data?.actionKey !== 'string') continue;
    runs.push({
      actionKey: data.actionKey,
      idempotencyKey: typeof data.idempotencyKey === 'string' ? data.idempotencyKey : null,
      at: row.createdAt.toISOString(),
    });
  }
  return runs;
}

export async function executeAiCeoAction(params: ExecuteActionParams): Promise<ExecuteActionResult> {
  const now = new Date();
  const settings = await getSettings();
  const recentRuns = await loadRecentAiCeoRuns(now);
  const level = permissionLevelOf({ role: params.actor.role, status: params.actor.status });

  const decision = evaluateActionPolicy({
    actionKey: params.actionKey,
    args: params.args,
    actorLevel: level,
    automation: {
      aiCeoEnabled: settings.aiCeo.enabled,
      actionsEnabled: settings.aiCeo.actionsEnabled,
    },
    idempotencyKey: params.idempotencyKey,
    recentRuns,
    now: now.toISOString(),
    dailyLimit: settings.aiCeo.dailyActionLimit,
  });

  if (!decision.allowed) {
    await auditLog({
      actor: { id: params.actor.id, email: params.actor.email },
      action: 'ai_ceo.action.denied',
      entityType: 'ai_ceo_action',
      entityId: params.actionKey.slice(0, 64),
      data: {
        actionKey: params.actionKey.slice(0, 64),
        code: decision.code,
        idempotencyKey: typeof params.idempotencyKey === 'string' ? params.idempotencyKey.slice(0, 128) : null,
      },
      req: params.req,
    });
    return { ok: false, code: decision.code, message: decision.message };
  }

  const definition = AI_CEO_ACTIONS[decision.action.key];
  let result: Record<string, unknown>;
  try {
    result = await runAction(decision.action.key, decision.args);
  } catch (err) {
    logger.error('AI CEO action failed', {
      actionKey: decision.action.key,
      error: err instanceof Error ? err.message : String(err),
    });
    await auditLog({
      actor: { id: params.actor.id, email: params.actor.email },
      action: 'ai_ceo.action.failed',
      entityType: 'ai_ceo_action',
      entityId: decision.action.key,
      data: {
        actionKey: decision.action.key,
        idempotencyKey: String(params.idempotencyKey ?? '').slice(0, 128),
        error: err instanceof Error ? err.message.slice(0, 300) : 'unknown error',
      },
      req: params.req,
    });
    return {
      ok: false,
      code: 'EXECUTION_FAILED',
      message: 'The action was accepted but failed while running. The failure is recorded in the audit log.',
    };
  }

  await auditLog({
    actor: { id: params.actor.id, email: params.actor.email },
    action: 'ai_ceo.action',
    entityType: 'ai_ceo_action',
    entityId: decision.action.key,
    data: {
      actionKey: decision.action.key,
      idempotencyKey: String(params.idempotencyKey ?? '').slice(0, 128),
      sideEffects: definition.sideEffects,
      result,
    },
    req: params.req,
  });

  return {
    ok: true,
    actionKey: decision.action.key,
    result,
    executedAt: now.toISOString(),
    remainingToday: decision.remainingToday,
    audit: 'written',
  };
}

async function runAction(actionKey: string, args: unknown): Promise<Record<string, unknown>> {
  switch (actionKey) {
    case 'RUN_JOB_QUEUE': {
      const { processDueJobs } = await import('@/lib/jobs/runner');
      const stats = await processDueJobs({ limit: 25 });
      return { ...(stats as unknown as Record<string, unknown>), cap: 25 };
    }
    case 'RUN_SUPPLIER_DRY_RUN': {
      const input = args as { supplierId: string; mode: 'IMPORT_ELIGIBLE_DRAFT' | 'SAFE_PUBLISH_ELIGIBLE'; limit: number };
      const supplier = await prisma.supplier.findUnique({
        where: { id: input.supplierId },
        select: { id: true, name: true, isActive: true },
      });
      if (!supplier) {
        throw new Error('Supplier not found');
      }
      if (!supplier.isActive) {
        throw new Error('Supplier is inactive; re-activate it before running a dry run');
      }
      const { buildSupplierDryRunReport } = await import('@/lib/catalog/dry-run');
      const report = await buildSupplierDryRunReport({
        supplierId: input.supplierId,
        mode: input.mode,
        limit: input.limit,
      });
      // Return the decision-relevant aggregates only; the full item list stays
      // in the dedicated dry-run screen.
      return {
        supplierId: report.supplierId,
        supplierName: supplier.name,
        mode: report.mode,
        examined: report.examined,
        truncated: report.truncated,
        wouldPublish: report.wouldPublish,
        wouldImportDraft: report.wouldImportDraft,
        wouldHold: report.wouldHold,
        wouldReject: report.wouldReject,
        wouldSkip: report.wouldSkip,
        alreadyMapped: report.alreadyMapped,
        economics: report.economics,
        thresholds: report.thresholds,
        writes: 0,
      };
    }
    case 'REFRESH_DERIVED_CACHE': {
      invalidateSettingsCache();
      const { revalidatePath } = await import('next/cache');
      const paths = ['/', '/shop', '/admin/ai-ceo'];
      for (const path of paths) revalidatePath(path);
      return { revalidatedPaths: paths, writes: 0 };
    }
    case 'CREATE_INTERNAL_TASK': {
      const input = args as { title: string; detail?: string; priority: 'LOW' | 'MEDIUM' | 'HIGH' };
      // The audit row IS the task record (see docs/AI_CEO.md): durable, indexed
      // by action, no schema migration required.
      return { taskTitle: input.title, priority: input.priority, detail: input.detail ?? null, storage: 'audit_log' };
    }
    case 'RECORD_REPORT_SNAPSHOT': {
      const snapshot = await loadAiCeoSnapshot();
      const report = buildAiCeoReport(snapshot);
      return {
        generatedAt: report.generatedAt,
        headline: report.headline,
        overallLevel: report.overallLevel,
        openRisks: report.risks.length,
        launchBlockers: report.readiness.filter((i) => i.blocks.includes('LAUNCH') && i.status !== 'PASS').length,
        topRecommendation: report.recommendations[0]?.id ?? null,
        writes: 0,
      };
    }
    default:
      throw new Error(`No runner for action ${actionKey}`);
  }
}
