import { apiRoute, jsonOk } from '@/lib/errors';
import { revokeCurrentSession } from '@/lib/auth/session';
import { auditLog } from '@/lib/audit';
import { getCurrentUser } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

export const POST = apiRoute(async (req: Request) => {
  const user = await getCurrentUser();
  await revokeCurrentSession();
  if (user) {
    await auditLog({ actor: { id: user.id, email: user.email }, action: 'auth.logout', req });
  }
  return jsonOk({ loggedOut: true });
});
