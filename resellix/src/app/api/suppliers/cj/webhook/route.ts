import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { assertRateLimit } from '@/lib/rate-limit';
import { clientIp } from '@/lib/http';
import { enqueueJob, kickJobRunner } from '@/lib/jobs/queue';

export const dynamic = 'force-dynamic';

/**
 * CJ Dropshipping webhook ingress (TRIGGER-ONLY).
 *
 * CJ pushes ORDER / LOGISTICS messages here without any signature we can
 * verify, so this endpoint NEVER applies statuses from the payload. It only:
 *   1. rate-limits the caller,
 *   2. matches the referenced order against CJ-type supplier orders we own,
 *   3. enqueues a SYNC_SUPPLIER_ORDER job, which re-fetches the authoritative
 *      status from CJ's API using our authenticated token.
 * A forged webhook can therefore at worst cause one extra authenticated read.
 * Configure the callback URL in CJ (or via adapter.registerWebhooks) as:
 *   https://<your-domain>/api/suppliers/cj/webhook
 */
export async function POST(req: Request): Promise<Response> {
  const ip = clientIp(req) ?? 'local';
  assertRateLimit(`cj-webhook:${ip}`, { limit: 60, windowMs: 60_000 });

  const payload = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const type = String(payload.type ?? 'ORDER').toUpperCase();
  const params = (payload.params ?? payload) as Record<string, unknown>;
  const candidates = [params.orderNum, params.cjOrderId, params.orderId, params.trackingNumber]
    .map((v) => (v === null || v === undefined ? null : String(v)))
    .filter((v): v is string => Boolean(v));

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const so = await prisma.supplierOrder.findFirst({
    where: { supplierOrderId: { in: candidates }, supplier: { type: 'CJ' } },
    select: { id: true, supplierOrderId: true },
  });
  if (!so) {
    logger.info('CJ webhook for unknown order ignored (trigger-only endpoint)', { type });
    return NextResponse.json({ ok: true, ignored: true });
  }

  // One sync per order per minute at most, even under webhook storms.
  const minuteBucket = Math.floor(Date.now() / 60_000);
  await enqueueJob({
    type: 'SYNC_SUPPLIER_ORDER',
    payload: { supplierOrderId: so.id },
    dedupeKey: `cj-webhook-sync:${so.id}:${minuteBucket}`,
  });
  kickJobRunner();
  return NextResponse.json({ ok: true, queued: true });
}
