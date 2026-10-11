import { z } from 'zod';
import { apiRoute, badRequest, jsonOk } from '@/lib/errors';
import { getCurrentUser } from '@/lib/auth/guards';
import {
  addToWishlist,
  getWishlistView,
  removeFromWishlist,
} from '@/lib/wishlist/service';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  productId: z.string().min(1).max(64),
});

export const GET = apiRoute(async () => {
  const user = await getCurrentUser();
  const view = await getWishlistView(user?.id ?? null);
  return jsonOk(view);
});

export const POST = apiRoute(async (req: Request) => {
  const user = await getCurrentUser();
  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) throw badRequest('Invalid wishlist payload', parsed.error.flatten());

  const view = await addToWishlist({
    userId: user?.id ?? null,
    productId: parsed.data.productId,
  });
  return jsonOk(view);
});

export const DELETE = apiRoute(async (req: Request) => {
  const user = await getCurrentUser();
  const url = new URL(req.url);
  const queryProductId = url.searchParams.get('productId');
  let productId = queryProductId;
  if (!productId) {
    const raw = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) throw badRequest('productId is required');
    productId = parsed.data.productId;
  }

  const view = await removeFromWishlist({
    userId: user?.id ?? null,
    productId,
  });
  return jsonOk(view);
});
