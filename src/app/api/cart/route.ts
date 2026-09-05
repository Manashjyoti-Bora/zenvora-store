import { apiRoute, jsonOk, badRequest } from '@/lib/errors';
import { addToCartSchema } from '@/lib/validation/schemas';
import { addToCart, getCartView } from '@/lib/cart/service';
import { getCurrentUser } from '@/lib/auth/guards';
import { assertRateLimit } from '@/lib/rate-limit';
import { clientIp, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(
  async () => {
    const user = await getCurrentUser();
    return jsonOk(await getCartView(user?.id ?? null));
  },
  { csrf: false }
);

export const POST = apiRoute(async (req: Request) => {
  const ip = clientIp(req) ?? 'local';
  assertRateLimit(`cart:${ip}`, { limit: 60, windowMs: 10 * 60_000 });

  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = addToCartSchema.parse(raw);
  const user = await getCurrentUser();

  const view = await addToCart({
    userId: user?.id ?? null,
    productId: body.productId,
    variantId: body.variantId ?? null,
    quantity: body.quantity,
  });
  return jsonOk(view);
});
