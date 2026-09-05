import { prisma } from './db';
import { sanitizeForLog, logger } from './logger';
import { sha256 } from './crypto';

/**
 * Audit trail for security-relevant and administrative actions.
 * Writes never throw: an audit failure is logged but must not break the
 * operation that triggered it (audit is best-effort, authz is not).
 */

export interface AuditEntry {
  actor?: { id?: string | null; email?: string | null } | null;
  action: string;
  entityType?: string;
  entityId?: string;
  data?: Record<string, unknown>;
  req?: Request;
}

export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  // One-way hash so we can correlate abuse without storing raw IPs.
  return sha256(`resellix-ip:${ip}`).slice(0, 32);
}

function clientIpFromRequest(req?: Request): string | null {
  if (!req) return null;
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip');
}

export async function auditLog(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actor?.id ?? null,
        actorEmail: entry.actor?.email ?? null,
        action: entry.action,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        data: (sanitizeForLog(entry.data ?? {}) ?? {}) as object,
        ipHash: hashIp(clientIpFromRequest(entry.req)),
        userAgent: entry.req ? (entry.req.headers.get('user-agent')?.slice(0, 300) ?? null) : null,
      },
    });
  } catch (err) {
    logger.error('Failed to write audit log', {
      action: entry.action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
