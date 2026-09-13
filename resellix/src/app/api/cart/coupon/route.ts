import { apiRoute, jsonOk, badRequest } from '@/lib/errors';
import { z } from 'zod';
import { applyCouponToCart, removeCouponFromCart } from '@/lib/cart/service';
import { getCurrentUser } from '@/lib/auth/guards';
import { readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

const applySchema = z.object({ code: z.string().trim().min(2).max(40) });

export const POST = apiRoute(async (req: Request) => {
  const raw = await readJson(req);
  if (!raw || typeof raw !== 'object') throw badRequest('Invalid request body');
  const body = applySchema.parse(raw);
  const user = await getCurrentUser();
  const view = await applyCouponToCart({
    userId: user?.id ?? null,
    code: body.code,
    guestEmail: null,
  });
  return jsonOk(view);
});

export const DELETE = apiRoute(async () => {
  const user = await getCurrentUser();
  return jsonOk(await removeCouponFromCart(user?.id ?? null));
});
