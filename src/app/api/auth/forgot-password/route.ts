import { apiRoute, jsonOk, badRequest } from '@/lib/errors';
import { forgotPasswordSchema } from '@/lib/validation/schemas';
import { requestPasswordReset } from '@/lib/auth/service';
import { assertRateLimit } from '@/lib/rate-limit';
import { clientIp, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(async (req: Request) => {
  const ip = clientIp(req) ?? 'local';
  assertRateLimit(`forgot:${ip}`, { limit: 5, windowMs: 30 * 60_000 });

  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = forgotPasswordSchema.parse(raw);

  // Always returns the same response - no account enumeration.
  const result = await requestPasswordReset({ email: body.email, req });
  return jsonOk(result);
});
