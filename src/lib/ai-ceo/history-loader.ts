import { prisma } from '@/lib/db';
import { summariseAiCeoHistory, type AiCeoHistoryEntry } from './history';

/**
 * Server-side read of the AI CEO audit trail. Bounded (take) and limited to the
 * AI-CEO action namespace so it can never be used to scrape the general audit
 * log. The mapping itself is the pure `summariseAiCeoHistory`.
 */

export const HISTORY_ACTIONS = [
  'ai_ceo.action',
  'ai_ceo.action.failed',
  'ai_ceo.action.denied',
  'ai_ceo.narrative',
  'ai_ceo.narrative.blocked',
  'ai_ceo.config.updated',
] as const;

export async function loadAiCeoHistory(limit = 12): Promise<AiCeoHistoryEntry[]> {
  const rows = await prisma.auditLog.findMany({
    where: { action: { in: [...HISTORY_ACTIONS] } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 50),
    select: { id: true, action: true, actorEmail: true, data: true, createdAt: true },
  });

  return summariseAiCeoHistory(
    rows.map((row) => ({
      id: row.id,
      action: row.action,
      actorEmail: row.actorEmail,
      data: row.data,
      createdAt: row.createdAt.toISOString(),
    }))
  );
}
