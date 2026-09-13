import { apiRoute, jsonOk, badRequest } from '@/lib/errors';
import { loginSchema } from '@/lib/validation/schemas';
import { loginUser } from '@/lib/auth/service';
import { attachGuestCartToUser } from '@/lib/cart/service';
import { assertRateLimit, rateLimit } from '@/lib/rate-limit';
import { clientIp, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(async (req: Request) => {
  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = loginSchema.parse(raw);

  const ip = clientIp(req) ?? 'local';
  // Two layers: per-IP brute-force protection and per-account throttling.
  assertRateLimit(`login:ip:${ip}`, { limit: 20, windowMs: 15 * 60_000 });
  const accountLimit = rateLimit(`login:account:${body.email}`, {
    limit: 8,
    windowMs: 15 * 60_000,
  });
  if (!accountLimit.success) {
    throw badRequest(
      `Too many login attempts for this account. Try again in ${accountLimit.retryAfterSec}s or reset your password.`
    );
  }

  const result = await loginUser({ email: body.email, password: body.password, req });
  await attachGuestCartToUser(result.user.id);
  return jsonOk(result);
});
