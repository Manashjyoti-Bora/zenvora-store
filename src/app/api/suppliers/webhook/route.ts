import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/errors';
import { handleSupplierWebhook } from '@/lib/suppliers/webhook';
import { kickJobRunner } from '@/lib/jobs/queue';

export const dynamic = 'force-dynamic';

/**
 * Generic inbound supplier webhook (public). Authenticated exclusively by
 * HMAC-SHA256 over the raw body with SUPPLIER_WEBHOOK_SECRET (see
 * docs/SUPPLIER_API.md for the payload contract).
 */
export async function POST(req: Request): Promise<Response> {
  try {
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
