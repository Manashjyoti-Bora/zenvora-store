import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { aiProviderConfig } from '@/lib/env';
import { auditLog } from '@/lib/audit';
import type { SessionUser } from '@/lib/auth/session';
import type { AiCeoReport } from './contracts';
import { generateNarrative, type NarrativeResult } from './provider';

/**
 * Server-side wiring for the optional AI narrative.
 *
 * All three gates must be open before any provider call:
 *   1. Settings.aiCeo.enabled — module switch;
 *   2. Settings.aiCeo.providerNarrativeEnabled — explicit opt-in for model use;
 *   3. a complete, validated provider configuration.
 * The 30-day token ceiling is computed from the audit log, so lowering the
 * budget takes effect immediately and cannot be bypassed by a client.
 */

const USAGE_WINDOW_MS = 30 * 86_400_000;

export async function narrativeTokensUsed(): Promise<number> {
  const rows = await prisma.auditLog.findMany({
    where: { action: 'ai_ceo.narrative', createdAt: { gte: new Date(Date.now() - USAGE_WINDOW_MS) } },
    select: { data: true },
    take: 1000,
  });
  let total = 0;
  for (const row of rows) {
    const tokens = (row.data as { tokensUsed?: unknown } | null)?.tokensUsed;
    if (typeof tokens === 'number' && Number.isFinite(tokens)) total += tokens;
  }
  return total;
}

export interface NarrativeRequestContext {
  actor: Pick<SessionUser, 'id' | 'email'>;
  req?: Request;
}

export async function generateAiCeoNarrative(
  report: AiCeoReport,
  ctx: NarrativeRequestContext
): Promise<NarrativeResult> {
  const settings = await getSettings();

  if (!settings.aiCeo.enabled) {
    return {
      ok: false,
      code: 'DISABLED',
      message: 'The AI CEO module is disabled in Settings.',
    };
  }

  const config = aiProviderConfig();
  const usedTokens30d = config && settings.aiCeo.providerNarrativeEnabled ? await narrativeTokensUsed() : 0;

  const result = await generateNarrative({
    report,
    config,
    budget: { usedTokens30d, monthlyTokenBudget: settings.aiCeo.monthlyTokenBudget },
    narrativeEnabled: settings.aiCeo.providerNarrativeEnabled,
  });

  // Record usage (or the reason nothing was generated) for auditability. The
  // narrative text itself is deliberately NOT stored: it is unverified prose.
  await auditLog({
    actor: { id: ctx.actor.id, email: ctx.actor.email },
    action: result.ok ? 'ai_ceo.narrative' : 'ai_ceo.narrative.blocked',
    entityType: 'ai_ceo_report',
    entityId: report.generatedAt,
    data: result.ok
      ? {
          model: result.model,
          provider: result.provider,
          tokensUsed: result.tokensUsed,
          characters: result.text.length,
          usedTokens30dBefore: usedTokens30d,
        }
      : { code: result.code },
    req: ctx.req,
  });

  return result;
}
