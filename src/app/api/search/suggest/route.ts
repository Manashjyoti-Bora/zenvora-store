import { apiRoute, jsonOk } from '@/lib/errors';
import { clientIp } from '@/lib/http';
import { assertRateLimit } from '@/lib/rate-limit';
import { SEARCH_MIN_CHARS, SEARCH_QUERY_MAX_LENGTH, suggestSearch } from '@/lib/catalog/search';

export const dynamic = 'force-dynamic';

/**
 * GET /api/search/suggest?q=…  — header typeahead.
 *
 * Public, read-only, bounded (≤10 products, ≤3 categories) and rate-limited
 * per IP because the client fires it while typing (debounced + aborted on the
 * client, but never trust that). Short queries return an empty result without
 * touching the database.
 */
export const GET = apiRoute(async (req: Request) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, SEARCH_QUERY_MAX_LENGTH);
  const headers = { 'cache-control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=120' };

  if (q.length < SEARCH_MIN_CHARS) {
    return jsonOk({ query: q, products: [], categories: [] }, { headers });
  }

  const ip = clientIp(req) ?? 'local';
  await assertRateLimit(`search-suggest:${ip}`, { limit: 120, windowMs: 10 * 60_000 });

  const result = await suggestSearch(q, { limit: 6 });
  return jsonOk(result, { headers });
});
