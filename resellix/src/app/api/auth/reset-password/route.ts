import { apiRoute, jsonOk, badRequest } from '@/lib/errors';
import { resetPasswordSchema } from '@/lib/validation/schemas';
import { resetPassword } from '@/lib/auth/service';
import { assertRateLimit } from '@/lib/rate-limit';
import { clientIp, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(async (req: Request) => {
  const ip = clientIp(req) ?? 'local';
  assertRateLimit(`reset:${ip}`, { limit: 10, windowMs: 30 * 60_000 });

  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = resetPasswordSchema.parse(raw);

  const result = await resetPassword({ token: body.token, password: body.password, req });
  return jsonOk(result);
});
