import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { logger, persistError } from './logger';
import { verifyCsrfFromRequest } from './csrf';

/** Typed HTTP error with a machine-readable code and optional field details. */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function badRequest(message: string, details?: unknown): ApiError {
  return new ApiError(400, message, 'BAD_REQUEST', details);
}
export function unauthorized(message = 'Authentication required'): ApiError {
  return new ApiError(401, message, 'UNAUTHORIZED');
}
export function forbidden(message = 'You do not have access to this resource'): ApiError {
  return new ApiError(403, message, 'FORBIDDEN');
}
export function notFound(message = 'Resource not found'): ApiError {
  return new ApiError(404, message, 'NOT_FOUND');
}
export function conflict(message: string, details?: unknown): ApiError {
  return new ApiError(409, message, 'CONFLICT', details);
}
export function tooManyRequests(retryAfterSec?: number): ApiError {
  const err = new ApiError(429, 'Too many requests. Please try again later.', 'RATE_LIMITED');
  (err as ApiError & { retryAfterSec?: number }).retryAfterSec = retryAfterSec;
  return err;
}

export type JsonRouteHandler<Ctx = unknown> = (
  req: Request,
  ctx: Ctx
) => Promise<NextResponse | Response> | NextResponse | Response;

interface RouteOptions {
  /** Verify the double-submit CSRF token for unsafe methods (default: true).
   *  Disable ONLY for endpoints authenticated by signature/shared secret
   *  (payment webhooks, supplier webhooks, cron). */
  csrf?: boolean;
}

/**
 * Wraps every JSON API route with consistent error handling:
 * - ZodError          -> 400 with field-level details
 * - ApiError          -> its status/code
 * - anything else     -> 500 generic message (details logged + persisted)
 * Also enforces CSRF protection on POST/PATCH/PUT/DELETE by default.
 */
export function apiRoute<Ctx = unknown>(
  handler: JsonRouteHandler<Ctx>,
  options: RouteOptions = {}
) {
  const csrfEnabled = options.csrf ?? true;
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    const method = req.method.toUpperCase();
    try {
      if (csrfEnabled && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
        await verifyCsrfFromRequest(req);
      }
      const result = await handler(req, ctx);
      return result instanceof Response ? result : NextResponse.json(result);
    } catch (err) {
      return handleApiError(err, req);
    }
  };
}

export function handleApiError(err: unknown, req?: Request): Response {
  const url = req ? new URL(req.url).pathname : undefined;

  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The submitted data is invalid.',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      },
      { status: 400 }
    );
  }

  if (err instanceof ApiError) {
    const headers: Record<string, string> = {};
    const retryAfter = (err as ApiError & { retryAfterSec?: number }).retryAfterSec;
    if (retryAfter) headers['Retry-After'] = String(retryAfter);
    if (err.statusCode >= 500) {
      logger.error(err.message, { code: err.code, url });
    }
    return NextResponse.json(
      { error: { code: err.code ?? 'ERROR', message: err.message, details: err.details ?? null } },
      { status: err.statusCode, headers }
    );
  }

  // Unknown errors: log with full detail, respond with a generic message so
  // internals are never leaked to clients.
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  logger.error('Unhandled API error', { message, url });
  void persistError(message, { stack, route: url, context: { type: 'api-route' } });
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } },
    { status: 500 }
  );
}

/** Standard JSON success envelope. */
export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data }, init);
}
