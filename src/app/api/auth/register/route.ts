import { apiRoute, jsonOk, badRequest } from '@/lib/errors';
import { registerSchema } from '@/lib/validation/schemas';
import { registerUser } from '@/lib/auth/service';
import { attachGuestCartToUser } from '@/lib/cart/service';
import { assertRateLimit } from '@/lib/rate-limit';
import { clientIp, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(async (req: Request) => {
  const ip = clientIp(req) ?? 'local';
  assertRateLimit(`register:${ip}`, { limit: 5, windowMs: 15 * 60_000 });

  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = registerSchema.parse(raw);

  const result = await registerUser({
    email: body.email,
    password: body.password,
    name: body.name,
    phone: body.phone || undefined,
    req,
  });
  await attachGuestCartToUser(result.user.id);
  return jsonOk(result, { status: 201 });
});
