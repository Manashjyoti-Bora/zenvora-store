import { apiRoute, jsonOk } from '@/lib/errors';
import { requireStaff } from '@/lib/auth/guards';
import { getFulfilmentReadinessReport } from '@/lib/catalog/fulfilment-readiness';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (req: Request) => {
  await requireStaff();
  const url = new URL(req.url);
  const includeDrafts = url.searchParams.get('includeDrafts') === 'true';
  const report = await getFulfilmentReadinessReport({ includeDrafts });
  return jsonOk(report);
});
