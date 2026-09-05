import { apiRoute, jsonOk } from '@/lib/errors';
import { getCurrentUser } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(
  async () => {
    const user = await getCurrentUser();
    return jsonOk({ user });
  },
  { csrf: false }
);
