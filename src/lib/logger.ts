/**
 * Application logger + secret sanitisation.
 *
 * Rules enforced here:
 * - Nothing that looks like a credential is ever written to logs (key-based
 *   redaction, applied recursively, before console AND before DB persistence).
 * - Console output is structured JSON lines for warn/error, plain for info.
 * - Errors are additionally persisted to the `error_logs` table so admins can
 *   review them in the dashboard without server access.
 */

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|apikey|api_key|key_secret|authorization|auth|x-api|signature|cvv|cvc|card|pin|otp|session|cookie|private)/i;

const MAX_DEPTH = 6;
const MAX_STRING_LEN = 2000;

export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[max-depth]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LEN ? `${value.slice(0, MAX_STRING_LEN)}…[truncated]` : value;
  }
  if (typeof value !== 'object') return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => sanitizeForLog(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY_PATTERN.test(k) ? '[REDACTED]' : sanitizeForLog(v, depth + 1);
  }
  return out;
}

type LogContext = Record<string, unknown>;

function emit(level: 'info' | 'warn' | 'error', message: string, context?: LogContext): void {
  const payload = context ? sanitizeForLog(context) : undefined;
  if (level === 'error' || level === 'warn') {
    // eslint-disable-next-line no-console
    console[level](JSON.stringify({ level, message, ...(payload ? { context: payload } : {}) }));
  } else if (process.env.NODE_ENV !== 'test') {
    // eslint-disable-next-line no-console
    console.info(message, payload ? JSON.stringify(payload) : '');
  }
}

export const logger = {
  info: (message: string, context?: LogContext) => emit('info', message, context),
  warn: (message: string, context?: LogContext) => emit('warn', message, context),
  error: (message: string, context?: LogContext) => emit('error', message, context),
};

/**
 * Persist an error to the database for the admin error-log screen.
 * Safe to call from anywhere: failures are swallowed (logging must never
 * take down a request) and payloads are sanitised.
 */
export async function persistError(
  message: string,
  opts?: {
    level?: 'WARN' | 'ERROR' | 'FATAL';
    stack?: string;
    route?: string;
    context?: LogContext;
  }
): Promise<void> {
  try {
    // Imported lazily so the logger works even if Prisma is unavailable.
    const { prisma } = await import('./db');
    await prisma.errorLog.create({
      data: {
        level: opts?.level ?? 'ERROR',
        message: message.slice(0, 1000),
        stack: opts?.stack?.slice(0, 8000) ?? null,
        route: opts?.route?.slice(0, 500) ?? null,
        context: (sanitizeForLog(opts?.context ?? {}) ?? {}) as object,
      },
    });
  } catch {
    // Never throw from logging.
  }
}
