import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/errors';
import { handleRazorpayWebhook } from '@/lib/payments/webhook';
import { kickJobRunner } from '@/lib/jobs/queue';
import { assertRateLimit } from '@/lib/rate-limit';
import { clientIp } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Razorpay webhook endpoint (public, NO CSRF/cookie auth).
 * Authenticity is established exclusively by the HMAC signature over the raw
 * body using RAZORPAY_WEBHOOK_SECRET. Duplicate deliveries are handled
 * idempotently via the webhook_events unique constraint. Rate-limited to blunt
 * unauthenticated flood attempts (legitimate gateway volume is far below this).
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const ip = clientIp(req) ?? 'local';
    assertRateLimit(`webhook-razorpay:${ip}`, { limit: 120, windowMs: 60_000 });
    const rawBody = await req.text();
    const signature = req.headers.get('x-razorpay-signature');
    const eventId = req.headers.get('x-razorpay-event-id');

    const result = await handleRazorpayWebhook(rawBody, signature, eventId);
    kickJobRunner();
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    return handleApiError(err, req);
  }
}
