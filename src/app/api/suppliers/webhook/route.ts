import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/errors';
import { handleSupplierWebhook } from '@/lib/suppliers/webhook';
import { kickJobRunner } from '@/lib/jobs/queue';
import { assertRateLimit } from '@/lib/rate-limit';
import { clientIp } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Generic inbound supplier webhook (public). Authenticated exclusively by
 * HMAC-SHA256 over the raw body with SUPPLIER_WEBHOOK_SECRET (see
 * docs/SUPPLIER_API.md for the payload contract). Rate-limited against floods.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const ip = clientIp(req) ?? 'local';
    assertRateLimit(`webhook-supplier:${ip}`, { limit: 120, windowMs: 60_000 });
    const rawBody = await req.text();
    const signature =
      req.headers.get('x-supplier-signature') ?? req.headers.get('x-hub-signature-256');
    const result = await handleSupplierWebhook(rawBody, signature);
    kickJobRunner();
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    return handleApiError(err, req);
  }
}
