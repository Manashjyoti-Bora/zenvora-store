import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/errors';
import { handleRazorpayWebhook } from '@/lib/payments/webhook';
import { kickJobRunner } from '@/lib/jobs/queue';

export const dynamic = 'force-dynamic';

/**
 * Razorpay webhook endpoint (public, NO CSRF/cookie auth).
 * Authenticity is established exclusively by the HMAC signature over the raw
 * body using RAZORPAY_WEBHOOK_SECRET. Duplicate deliveries are handled
 * idempotently via the webhook_events unique constraint.
 */
export async function POST(req: Request): Promise<Response> {
  try {
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
